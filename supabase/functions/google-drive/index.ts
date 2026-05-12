import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

// ── SolidWorks SLDPRT preview extraction ─────────────────────────────────────
// SLDPRT is an OLE Compound File (CFBF). Preview is stored in one of:
//   - "PreviewPNG" stream (SW 2017+)         → raw PNG bytes
//   - "Preview" or "JPEGData" stream          → raw JPEG
//   - "\x05ThumbnailJPEG" stream              → JPEG
//   - SummaryInformation PIDSI_THUMBNAIL      → DIB/CF_DIB

const CFBF_SIG = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
const ENDOFCHAIN = 0xFFFFFFFE;

interface DirEntry { name: string; type: number; startSec: number; size: number; }

function readCfbf(raw: Uint8Array): { sectors: Uint8Array[]; dir: DirEntry[]; mini: Uint8Array; miniFat: number[]; fat: number[]; sectorSize: number } | null {
  if (raw.length < 512) return null;
  for (let i = 0; i < 8; i++) if (raw[i] !== CFBF_SIG[i]) return null;
  const v = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const sectorShift  = v.getUint16(30, true);
  const miniShift    = v.getUint16(32, true);
  const numFatSecs   = v.getUint32(44, true);
  const dirStart     = v.getUint32(48, true);
  const miniCutoff   = v.getUint32(56, true);
  const miniFatStart = v.getUint32(60, true);
  const numMiniFat   = v.getUint32(64, true);
  const difatStart   = v.getUint32(68, true);
  const numDifat     = v.getUint32(72, true);

  const sectorSize = 1 << sectorShift;
  const miniSize   = 1 << miniShift;
  const totalSecs  = Math.floor((raw.length - 512) / sectorSize);

  const sectors: Uint8Array[] = [];
  for (let i = 0; i < totalSecs; i++) {
    sectors.push(raw.subarray(512 + i * sectorSize, 512 + (i + 1) * sectorSize));
  }

  // Build DIFAT (list of FAT sector indices)
  const difat: number[] = [];
  for (let i = 0; i < 109; i++) {
    const s = v.getUint32(76 + i * 4, true);
    if (s < totalSecs) difat.push(s);
  }
  let nextDifat = difatStart;
  for (let n = 0; n < numDifat && nextDifat < totalSecs; n++) {
    const ds = sectors[nextDifat];
    const dv = new DataView(ds.buffer, ds.byteOffset, ds.byteLength);
    for (let i = 0; i < (sectorSize / 4) - 1; i++) {
      const s = dv.getUint32(i * 4, true);
      if (s < totalSecs) difat.push(s);
    }
    nextDifat = dv.getUint32(sectorSize - 4, true);
  }

  // Read FAT
  const fat: number[] = [];
  for (const fatSec of difat.slice(0, numFatSecs)) {
    if (fatSec >= totalSecs) continue;
    const fs = sectors[fatSec];
    const fv = new DataView(fs.buffer, fs.byteOffset, fs.byteLength);
    for (let i = 0; i < sectorSize / 4; i++) fat.push(fv.getUint32(i * 4, true));
  }

  // Read MiniFAT
  const miniFat: number[] = [];
  let mfSec = miniFatStart;
  for (let n = 0; n < numMiniFat && mfSec < totalSecs && mfSec !== ENDOFCHAIN; n++) {
    const ms = sectors[mfSec];
    const mv = new DataView(ms.buffer, ms.byteOffset, ms.byteLength);
    for (let i = 0; i < sectorSize / 4; i++) miniFat.push(mv.getUint32(i * 4, true));
    mfSec = fat[mfSec] ?? ENDOFCHAIN;
  }

  // Read directory
  const dirChain = walkChain(fat, dirStart, totalSecs);
  const dirBytes = concatSectors(sectors, dirChain);
  const dir: DirEntry[] = [];
  for (let i = 0; i < dirBytes.length; i += 128) {
    const dv = new DataView(dirBytes.buffer, dirBytes.byteOffset + i, 128);
    const nameLen = dv.getUint16(64, true);
    if (nameLen === 0) { dir.push({ name: "", type: 0, startSec: 0, size: 0 }); continue; }
    let name = "";
    for (let k = 0; k < (nameLen / 2) - 1; k++) {
      name += String.fromCharCode(dv.getUint16(k * 2, true));
    }
    dir.push({
      name,
      type: dv.getUint8(66),
      startSec: dv.getUint32(116, true),
      size: dv.getUint32(120, true),
    });
  }

  // Mini stream lives in root entry (dir[0])
  const root = dir[0];
  const miniChain = root ? walkChain(fat, root.startSec, totalSecs) : [];
  const mini = concatSectors(sectors, miniChain);

  return { sectors, dir, mini, miniFat, fat, sectorSize, miniCutoff, miniSize } as any;
}

function walkChain(fat: number[], start: number, totalSecs: number): number[] {
  const chain: number[] = [];
  let s = start;
  const seen = new Set<number>();
  while (s !== ENDOFCHAIN && s < totalSecs && !seen.has(s)) {
    seen.add(s);
    chain.push(s);
    s = fat[s] ?? ENDOFCHAIN;
  }
  return chain;
}

function concatSectors(sectors: Uint8Array[], chain: number[]): Uint8Array {
  const out = new Uint8Array(chain.length * (sectors[0]?.length ?? 0));
  for (let i = 0; i < chain.length; i++) out.set(sectors[chain[i]], i * sectors[0].length);
  return out;
}

function readStream(cfb: any, entry: DirEntry): Uint8Array {
  if (entry.size < cfb.miniCutoff) {
    const chain: number[] = [];
    let s = entry.startSec;
    const seen = new Set<number>();
    while (s !== ENDOFCHAIN && !seen.has(s)) {
      seen.add(s); chain.push(s);
      s = cfb.miniFat[s] ?? ENDOFCHAIN;
    }
    const out = new Uint8Array(entry.size);
    for (let i = 0; i < chain.length; i++) {
      const off = chain[i] * cfb.miniSize;
      const len = Math.min(cfb.miniSize, entry.size - i * cfb.miniSize);
      if (len <= 0) break;
      out.set(cfb.mini.subarray(off, off + len), i * cfb.miniSize);
    }
    return out;
  }
  const totalSecs = cfb.sectors.length;
  const chain = walkChain(cfb.fat, entry.startSec, totalSecs);
  const out = new Uint8Array(entry.size);
  for (let i = 0; i < chain.length; i++) {
    const len = Math.min(cfb.sectorSize, entry.size - i * cfb.sectorSize);
    if (len <= 0) break;
    out.set(cfb.sectors[chain[i]].subarray(0, len), i * cfb.sectorSize);
  }
  return out;
}

function dibToBmp(dib: Uint8Array): Uint8Array | null {
  if (dib.length < 40) return null;
  const v = new DataView(dib.buffer, dib.byteOffset, dib.byteLength);
  const biSize = v.getUint32(0, true);
  if (biSize !== 40) return null;
  const w  = v.getInt32(4, true);
  const h  = v.getInt32(8, true);
  const bc = v.getUint16(14, true);
  const cu = v.getUint32(32, true);
  if (Math.abs(w) > 8192 || Math.abs(h) > 8192) return null;
  const ctEntries = bc <= 8 ? (cu > 0 ? cu : (1 << bc)) : 0;
  const ctSize = ctEntries * 4;
  const pxOff = 14 + 40 + ctSize;
  const bmp = new Uint8Array(14 + dib.length);
  const bv = new DataView(bmp.buffer);
  bmp[0] = 0x42; bmp[1] = 0x4D;
  bv.setUint32(2,  14 + dib.length, true);
  bv.setUint32(10, pxOff, true);
  bmp.set(dib, 14);
  return bmp;
}

function extractFromSummaryInfo(stream: Uint8Array): { bytes: Uint8Array; mime: string } | null {
  // Property Set Stream → first section → property PIDSI_THUMBNAIL = 0x11
  if (stream.length < 48) return null;
  const v = new DataView(stream.buffer, stream.byteOffset, stream.byteLength);
  const numSections = v.getUint32(24, true);
  if (numSections === 0) return null;
  const sectionOffset = v.getUint32(44, true);
  if (sectionOffset >= stream.length) return null;
  const propCount = v.getUint32(sectionOffset + 4, true);
  for (let i = 0; i < propCount; i++) {
    const pid    = v.getUint32(sectionOffset + 8 + i * 8, true);
    const offset = v.getUint32(sectionOffset + 12 + i * 8, true);
    if (pid !== 0x11) continue;
    const propStart = sectionOffset + offset;
    if (propStart + 16 > stream.length) return null;
    // VT_CF (0x0047) — Clipboard format. Layout: type(4) | size(4) | format(4) | data
    const size = v.getUint32(propStart + 4, true);
    const cfFormat = v.getUint32(propStart + 8, true);  // -1=DIB, 3=DIB
    const dataStart = propStart + 12;
    const dataLen = size - 4;
    if (dataStart + dataLen > stream.length) return null;
    const data = stream.subarray(dataStart, dataStart + dataLen);
    // Try DIB
    const bmp = dibToBmp(data);
    if (bmp) return { bytes: bmp, mime: "image/bmp" };
    // Try JPEG/PNG raw
    if (data[0] === 0xFF && data[1] === 0xD8) return { bytes: data, mime: "image/jpeg" };
    if (data[0] === 0x89 && data[1] === 0x50) return { bytes: data, mime: "image/png" };
  }
  return null;
}

function extractSldprtPreview(raw: Uint8Array): { bytes: Uint8Array; mime: string; source: string } | { debug: any } {
  const cfb = readCfbf(raw);
  if (!cfb) {
    return { debug: { error: "not_cfbf", first8: Array.from(raw.slice(0, 8)).map(b => b.toString(16)) } };
  }
  const allEntries = cfb.dir.map((d: DirEntry) => ({
    name:     Array.from(d.name).map(c => c.charCodeAt(0) < 32 ? "\\x" + c.charCodeAt(0).toString(16).padStart(2, "0") : c).join(""),
    type:     d.type,
    size:     d.size,
    startSec: d.startSec,
  }));
  console.log("[extract] dir entries:", JSON.stringify(allEntries));

  const stripPrefix = (s: string) => (s.charCodeAt(0) === 0x01 || s.charCodeAt(0) === 0x05) ? s.slice(1) : s;
  const findStream = (...names: string[]) => cfb.dir.find((d: DirEntry) =>
    d.type === 2 && names.some(n => stripPrefix(d.name) === stripPrefix(n)));

  // Try direct preview streams
  const previewPng = findStream("PreviewPNG");
  if (previewPng && previewPng.size > 0) {
    const data = readStream(cfb, previewPng);
    if (data[0] === 0x89 && data[1] === 0x50) return { bytes: data, mime: "image/png", source: "PreviewPNG" };
    if (data[0] === 0xFF && data[1] === 0xD8) return { bytes: data, mime: "image/jpeg", source: "PreviewPNG-jpeg" };
  }

  const previewJpeg = findStream("ThumbnailJPEG", "ThumbnailJPEG", "JPEGData", "Preview");
  if (previewJpeg && previewJpeg.size > 0) {
    const data = readStream(cfb, previewJpeg);
    if (data[0] === 0xFF && data[1] === 0xD8) return { bytes: data, mime: "image/jpeg", source: previewJpeg.name };
    if (data[0] === 0x89 && data[1] === 0x50) return { bytes: data, mime: "image/png", source: previewJpeg.name };
  }

  // Try SummaryInformation thumbnail property
  const summary = findStream("SummaryInformation");
  if (summary && summary.size > 0) {
    const data = readStream(cfb, summary);
    const r = extractFromSummaryInfo(data);
    if (r) return { ...r, source: "SummaryInformation" };
  }

  // Try DocumentSummaryInformation
  const docSum = findStream("DocumentSummaryInformation");
  if (docSum && docSum.size > 0) {
    const data = readStream(cfb, docSum);
    const r = extractFromSummaryInfo(data);
    if (r) return { ...r, source: "DocumentSummaryInformation" };
  }

  return { debug: { entries: allEntries } };
}

// ── Google Service Account JWT ────────────────────────────────────────────────

function pemToBytes(pem: string): Uint8Array {
  const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const binary = atob(b64);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function b64url(obj: object): string {
  return btoa(JSON.stringify(obj))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

async function getGoogleAccessToken(email: string, privateKeyPem: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: email,
    scope: "https://www.googleapis.com/auth/drive",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const sigInput = `${b64url(header)}.${b64url(claims)}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToBytes(privateKeyPem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBytes = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(sigInput),
  );
  const sig = btoa(String.fromCharCode(...new Uint8Array(sigBytes)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");

  const jwt = `${sigInput}.${sig}`;

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const data = await resp.json();
  if (!data.access_token) throw new Error(`Google auth failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

// ── Drive API helpers ─────────────────────────────────────────────────────────

async function createDriveFolder(
  token: string,
  name: string,
  parentId?: string,
): Promise<{ id: string }> {
  const body: Record<string, unknown> = {
    name,
    mimeType: "application/vnd.google-apps.folder",
  };
  if (parentId) body.parents = [parentId];

  const resp = await fetch(
    "https://www.googleapis.com/drive/v3/files?fields=id&supportsAllDrives=true",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  const data = await resp.json();
  if (!data.id) throw new Error(`Drive folder creation failed: ${JSON.stringify(data)}`);
  return data;
}

async function uploadFileToDrive(
  token: string,
  folderId: string,
  filename: string,
  mimeType: string,
  fileUrl: string,
): Promise<{ id: string; webViewLink: string }> {
  const fileResp = await fetch(fileUrl);
  if (!fileResp.ok) throw new Error(`Failed to fetch file from storage: ${fileResp.status}`);
  const fileBytes = await fileResp.arrayBuffer();

  const boundary = `drive_${Date.now()}`;
  const metadata = JSON.stringify({ name: filename, parents: [folderId] });
  const enc = new TextEncoder();

  const parts = [
    enc.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`),
    enc.encode(`--${boundary}\r\nContent-Type: ${mimeType || "application/octet-stream"}\r\n\r\n`),
    new Uint8Array(fileBytes),
    enc.encode(`\r\n--${boundary}--`),
  ];

  const totalLen = parts.reduce((n, p) => n + p.byteLength, 0);
  const body = new Uint8Array(totalLen);
  let off = 0;
  for (const p of parts) { body.set(p, off); off += p.byteLength; }

  const resp = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink&supportsAllDrives=true",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  );
  const data = await resp.json();
  if (!data.id) throw new Error(`Drive upload failed: ${JSON.stringify(data)}`);
  return data;
}

// ── Main handler ──────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Unauthorized" }, 401);

  try {
    const { action, ...payload } = await req.json();

    const serviceEmail = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_EMAIL");
    const privateKeyPem = (Deno.env.get("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY") ?? "")
      .replace(/\\n/g, "\n");
    const parentFolderId = Deno.env.get("GOOGLE_DRIVE_PARENT_FOLDER_ID");

    if (!serviceEmail || !privateKeyPem) {
      return json({ error: "Google Drive not configured" }, 503);
    }

    const gtoken = await getGoogleAccessToken(serviceEmail, privateKeyPem);

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ── create_folder ─────────────────────────────────────────
    if (action === "create_folder") {
      const { project_id, project_name } = payload as { project_id: string; project_name: string };
      const folder = await createDriveFolder(gtoken, project_name, parentFolderId);
      await sb.from("projects").update({ drive_folder_id: folder.id }).eq("id", project_id);
      return json({ folder_id: folder.id, folder_url: `https://drive.google.com/drive/folders/${folder.id}` });
    }

    // ── ensure_folder ─────────────────────────────────────────
    if (action === "ensure_folder") {
      const { project_id, project_name, folder_id } = payload as {
        project_id: string; project_name: string; folder_id?: string;
      };
      if (folder_id) {
        const check = await fetch(
          `https://www.googleapis.com/drive/v3/files/${folder_id}?supportsAllDrives=true&fields=id`,
          { headers: { Authorization: `Bearer ${gtoken}` } },
        );
        if (check.ok) return json({ folder_id, recreated: false });
      }
      const folder = await createDriveFolder(gtoken, project_name, parentFolderId);
      await sb.from("projects").update({ drive_folder_id: folder.id }).eq("id", project_id);
      return json({ folder_id: folder.id, recreated: true });
    }

    // ── upload_file ───────────────────────────────────────────
    if (action === "upload_file") {
      const { file_id, project_id, file_url, filename, mime_type } = payload as {
        file_id: string; project_id: string; file_url: string; filename: string; mime_type: string;
      };

      const { data: project } = await sb
        .from("projects")
        .select("drive_folder_id, name")
        .eq("id", project_id)
        .single();

      if (!project) return json({ skipped: true });

      let folderId = project.drive_folder_id;
      if (folderId) {
        const check = await fetch(
          `https://www.googleapis.com/drive/v3/files/${folderId}?supportsAllDrives=true&fields=id`,
          { headers: { Authorization: `Bearer ${gtoken}` } },
        );
        if (!check.ok) {
          const folder = await createDriveFolder(gtoken, project.name, parentFolderId);
          await sb.from("projects").update({ drive_folder_id: folder.id }).eq("id", project_id);
          folderId = folder.id;
        }
      }
      if (!folderId) return json({ skipped: true });

      const driveFile = await uploadFileToDrive(
        gtoken,
        folderId,
        filename,
        mime_type,
        file_url,
      );
      await sb.from("files").update({ drive_file_id: driveFile.id }).eq("id", file_id);
      return json({ drive_file_id: driveFile.id, drive_file_url: driveFile.webViewLink });
    }

    // ── sync_from_drive ───────────────────────────────────────
    if (action === "sync_from_drive") {
      const { project_id, folder_id } = payload as { project_id: string; folder_id: string };

      const q = encodeURIComponent(
        `'${folder_id}' in parents and trashed=false and mimeType != 'application/vnd.google-apps.folder'`
      );
      const listResp = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType,size,webViewLink,modifiedTime)&supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=allDrives&pageSize=1000`,
        { headers: { Authorization: `Bearer ${gtoken}` } },
      );
      const listData = await listResp.json();
      console.log("[sync_from_drive] folder:", folder_id, "status:", listResp.status, "files:", listData.files?.length ?? 0, listData.error ? JSON.stringify(listData.error) : "");
      const driveFiles: Array<{ id: string; name: string; mimeType: string; size?: string; webViewLink: string; modifiedTime?: string }> =
        listData.files ?? [];

      if (driveFiles.length === 0) return json({ synced: 0, debug: listData.error ?? null });

      const { data: existing } = await sb
        .from("files")
        .select("id, drive_file_id, file_size, source, filename")
        .eq("project_id", project_id)
        .not("drive_file_id", "is", null);

      type ExistingRow = { id: string; drive_file_id: string; file_size: number | null; source: string; filename: string };
      const existingArr: ExistingRow[] = (existing ?? []) as ExistingRow[];
      const existingByDriveId = new Map(existingArr.map((f) => [f.drive_file_id, f]));
      const driveIds = new Set(driveFiles.map((f) => f.id));

      // Reattachment: when a Drive file's id isn't in the DB but a same-
      // named row exists whose drive_file_id is no longer in the Drive
      // listing, the user replaced the file in Drive (which can mint a
      // new file id depending on the client). Update the existing row in
      // place instead of inserting a duplicate.
      const reattachedIds = new Set<string>();
      const newFiles: typeof driveFiles = [];
      const changedFiles: typeof driveFiles = [];

      for (const f of driveFiles) {
        const ex = existingByDriveId.get(f.id);
        if (ex) {
          if (f.size != null && parseInt(f.size, 10) !== (ex.file_size ?? -1)) {
            changedFiles.push(f);
          }
          continue;
        }
        const orphan = existingArr.find((row) =>
          row.filename === f.name &&
          !driveIds.has(row.drive_file_id) &&
          !reattachedIds.has(row.id),
        );
        if (orphan) {
          await sb.from("files").update({
            drive_file_id: f.id,
            file_size:     f.size ? parseInt(f.size, 10) : null,
            stl_url:       null,
            thumbnail_url: null,
            modified_at:   f.modifiedTime ?? new Date().toISOString(),
          }).eq("id", orphan.id);
          reattachedIds.add(orphan.id);
          console.log("[sync_from_drive] reattached", f.name, "→ row", orphan.id);
          continue;
        }
        newFiles.push(f);
      }

      // Files in DB whose drive_file_id is no longer present in Drive AND
      // weren't reattached above → user genuinely removed them. Limit to
      // source='drive' so we never auto-delete a user upload.
      const removedRows = existingArr.filter((f) =>
        f.source === "drive" &&
        !driveIds.has(f.drive_file_id) &&
        !reattachedIds.has(f.id),
      );

      if (newFiles.length > 0) {
        await sb.from("files").insert(
          newFiles.map((f) => ({
            project_id,
            filename:      f.name,
            file_url:      f.webViewLink,
            file_size:     f.size ? parseInt(f.size, 10) : null,
            mime_type:     f.mimeType || "application/octet-stream",
            source:        "drive",
            drive_file_id: f.id,
            modified_at:   f.modifiedTime ?? new Date().toISOString(),
          })),
        );
      }

      for (const f of changedFiles) {
        const ex = existingMap.get(f.id)!;
        await sb.from("files")
          .update({
            file_size:     parseInt(f.size!, 10),
            stl_url:       null,
            thumbnail_url: null,
            modified_at:   f.modifiedTime ?? new Date().toISOString(),
          })
          .eq("id", ex.id);
        console.log("[sync_from_drive] size change on", f.name, "— cleared stl_url/thumbnail_url");
      }

      let removed = 0;
      if (removedRows.length > 0) {
        const ids = removedRows.map((r: { id: string }) => r.id);
        // Best-effort cleanup of derived storage objects.
        const thumbPaths = ids.map((id: string) => `file-thumbnails/${id}.png`)
                              .concat(ids.map((id: string) => `file-thumbnails/${id}.jpg`))
                              .concat(ids.map((id: string) => `file-thumbnails/${id}.bmp`));
        const stlPaths   = ids.map((id: string) => `file-stl/${id}.stl`);
        await sb.storage.from("contractor-hub-files").remove([...thumbPaths, ...stlPaths]).catch(() => {});

        const { error: delErr } = await sb.from("files").delete().in("id", ids);
        if (delErr) {
          console.error("[sync_from_drive] delete failed:", delErr.message);
        } else {
          removed = ids.length;
          console.log("[sync_from_drive] removed", removed, "rows that disappeared from Drive");
        }
      }

      return json({ synced: newFiles.length, updated: changedFiles.length, removed });
    }

    // ── delete_folder ─────────────────────────────────────────
    if (action === "delete_folder") {
      const { folder_id } = payload as { folder_id: string };
      await fetch(
        `https://www.googleapis.com/drive/v3/files/${folder_id}?supportsAllDrives=true`,
        { method: "DELETE", headers: { Authorization: `Bearer ${gtoken}` } },
      );
      return json({ deleted: true });
    }

    // ── get_thumbnail ─────────────────────────────────────────
    if (action === "get_thumbnail") {
      const { db_file_id, drive_file_id, debug } = payload as { db_file_id: string; drive_file_id: string; debug?: boolean };

      // 1. Try Drive's own thumbnailLink (Google generates these for many file types)
      const metaResp = await fetch(
        `https://www.googleapis.com/drive/v3/files/${drive_file_id}?fields=thumbnailLink,hasThumbnail&supportsAllDrives=true`,
        { headers: { Authorization: `Bearer ${gtoken}` } },
      );
      const meta = await metaResp.json();
      if (meta.thumbnailLink) {
        const thumbUrl = String(meta.thumbnailLink).replace(/=s\d+(-c)?$/, "=s640");
        const thumbResp = await fetch(thumbUrl, { headers: { Authorization: `Bearer ${gtoken}` } });
        if (thumbResp.ok) {
          const bytes = new Uint8Array(await thumbResp.arrayBuffer());
          const isPng  = bytes[0] === 0x89 && bytes[1] === 0x50;
          const isJpeg = bytes[0] === 0xFF && bytes[1] === 0xD8;
          if (isPng || isJpeg) {
            const ext = isPng ? "png" : "jpg";
            const path = `file-thumbnails/${db_file_id}.${ext}`;
            const { error: upErr } = await sb.storage.from("contractor-hub-files").upload(path, bytes, { contentType: isPng ? "image/png" : "image/jpeg", upsert: true });
            if (!upErr) {
              const { data: { publicUrl } } = sb.storage.from("contractor-hub-files").getPublicUrl(path);
              await sb.from("files").update({ thumbnail_url: publicUrl }).eq("id", db_file_id);
              return json({ thumbnail_url: publicUrl, source: "drive-thumbnailLink" });
            }
          }
        }
      }

      // 2. Fall back to byte extraction
      const fileResp = await fetch(
        `https://www.googleapis.com/drive/v3/files/${drive_file_id}?alt=media&supportsAllDrives=true`,
        { headers: { Authorization: `Bearer ${gtoken}` } },
      );
      if (!fileResp.ok) return json({ skipped: true, reason: `drive ${fileResp.status}` });
      const raw = new Uint8Array(await fileResp.arrayBuffer());

      // Diagnostic: search for any OLE signature anywhere in the file, JPEG markers, PNG markers
      if (debug) {
        const oleOffsets: number[] = [];
        const jpegOffsets: number[] = [];
        const pngOffsets: number[] = [];
        for (let i = 0; i < raw.length - 8; i++) {
          if (raw[i] === 0xD0 && raw[i+1] === 0xCF && raw[i+2] === 0x11 && raw[i+3] === 0xE0) {
            oleOffsets.push(i); if (oleOffsets.length > 5) break;
          }
        }
        for (let i = 0; i < raw.length - 3; i++) {
          if (raw[i] === 0xFF && raw[i+1] === 0xD8 && raw[i+2] === 0xFF) {
            jpegOffsets.push(i); if (jpegOffsets.length > 10) break;
          }
        }
        for (let i = 0; i < raw.length - 4; i++) {
          if (raw[i] === 0x89 && raw[i+1] === 0x50 && raw[i+2] === 0x4E && raw[i+3] === 0x47) {
            pngOffsets.push(i); if (pngOffsets.length > 5) break;
          }
        }
        const first64 = Array.from(raw.slice(0, 64)).map(b => b.toString(16).padStart(2, "0")).join(" ");
        return json({ skipped: true, debug: { size: raw.length, first64, oleOffsets, jpegOffsets, pngOffsets } });
      }

      const result = extractSldprtPreview(raw);
      if ("debug" in result) {
        return json({ skipped: true, hasThumbnail: meta.hasThumbnail });
      }

      const ext = result.mime === "image/png" ? "png" : result.mime === "image/bmp" ? "bmp" : "jpg";
      const path = `file-thumbnails/${db_file_id}.${ext}`;
      const { error: upErr } = await sb.storage
        .from("contractor-hub-files")
        .upload(path, result.bytes, { contentType: result.mime, upsert: true });
      if (upErr) return json({ error: upErr.message }, 500);

      const { data: { publicUrl } } = sb.storage.from("contractor-hub-files").getPublicUrl(path);
      await sb.from("files").update({ thumbnail_url: publicUrl }).eq("id", db_file_id);

      console.log("[get_thumbnail] success:", result.source, result.mime, result.bytes.length, "bytes");
      return json({ thumbnail_url: publicUrl, source: result.source });
    }

    // ── convert_to_stl ────────────────────────────────────────
    if (action === "convert_to_stl") {
      const { db_file_id, drive_file_id } = payload as { db_file_id: string; drive_file_id: string };

      const ccKey = Deno.env.get("CLOUDCONVERT_API_KEY");
      if (!ccKey) return json({ error: "CloudConvert not configured" }, 503);

      // Download SLDPRT from Drive
      const fileResp = await fetch(
        `https://www.googleapis.com/drive/v3/files/${drive_file_id}?alt=media&supportsAllDrives=true`,
        { headers: { Authorization: `Bearer ${gtoken}` } },
      );
      console.log("[convert_to_stl] drive download status:", fileResp.status, "size:", fileResp.headers.get("content-length"));
      if (!fileResp.ok) return json({ error: `Drive download failed: ${fileResp.status}` }, 500);
      const fileBytes = new Uint8Array(await fileResp.arrayBuffer());
      console.log("[convert_to_stl] downloaded", fileBytes.length, "bytes");

      // Create CloudConvert job
      const jobResp = await fetch("https://api.cloudconvert.com/v2/jobs", {
        method: "POST",
        headers: { Authorization: `Bearer ${ccKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          tasks: {
            "import-file": { operation: "import/upload" },
            "convert":     { operation: "convert", input: ["import-file"], output_format: "stl" },
            "export":      { operation: "export/url", input: ["convert"], inline: false, archive_multiple_files: false },
          },
        }),
      });
      const job = await jobResp.json();
      console.log("[convert_to_stl] job id:", job.data?.id, "status:", job.data?.status);
      if (!job.data?.id) return json({ error: `CloudConvert job creation failed: ${JSON.stringify(job)}` }, 500);

      // Upload file to CloudConvert import form
      const importTask = (job.data.tasks as any[]).find(t => t.name === "import-file");
      if (!importTask?.result?.form) return json({ error: "No upload form in job" }, 500);
      const { url: uploadUrl, parameters } = importTask.result.form;
      const form = new FormData();
      for (const [k, v] of Object.entries(parameters as Record<string, string>)) form.append(k, v);
      form.append("file", new Blob([fileBytes], { type: "application/octet-stream" }), "model.sldprt");
      const uploadResp = await fetch(uploadUrl, { method: "POST", body: form });
      console.log("[convert_to_stl] upload status:", uploadResp.status);

      // Poll until finished (max 25 × 4 s = 100 s)
      const jobId: string = job.data.id;
      let stlBytes: Uint8Array | null = null;
      for (let i = 0; i < 25; i++) {
        await new Promise(r => setTimeout(r, 4000));
        const statusResp = await fetch(`https://api.cloudconvert.com/v2/jobs/${jobId}`, {
          headers: { Authorization: `Bearer ${ccKey}` },
        });
        const status = await statusResp.json();
        const jobStatus: string = status.data?.status ?? "";
        console.log("[convert_to_stl] poll", i + 1, "status:", jobStatus);
        if (jobStatus === "finished") {
          const exportTask = (status.data.tasks as any[]).find(t => t.name === "export");
          const stlUrl: string | undefined = exportTask?.result?.files?.[0]?.url;
          if (!stlUrl) return json({ error: "No STL in export result" }, 500);
          const stlResp = await fetch(stlUrl);
          stlBytes = new Uint8Array(await stlResp.arrayBuffer());
          console.log("[convert_to_stl] STL bytes:", stlBytes.length);
          break;
        }
        if (jobStatus === "error") {
          const errTask = (status.data.tasks as any[]).find(t => t.status === "error");
          return json({ error: `Conversion error: ${errTask?.message ?? "unknown"}` }, 500);
        }
      }

      if (!stlBytes) return json({ error: "Conversion timed out" }, 504);

      // Store in Supabase Storage
      const path = `file-stl/${db_file_id}.stl`;
      const { error: upErr } = await sb.storage
        .from("contractor-hub-files")
        .upload(path, stlBytes, { contentType: "model/stl", upsert: true });
      if (upErr) return json({ error: upErr.message }, 500);

      const { data: { publicUrl } } = sb.storage.from("contractor-hub-files").getPublicUrl(path);
      await sb.from("files").update({ stl_url: publicUrl }).eq("id", db_file_id);
      console.log("[convert_to_stl] done:", publicUrl);
      return json({ stl_url: publicUrl });
    }

    // ── refresh_modified_times ────────────────────────────────
    // One-off backfill: for every files row with a drive_file_id, pull the
    // current Drive modifiedTime and write it to files.modified_at.
    if (action === "refresh_modified_times") {
      const { data: rows, error: selErr } = await sb
        .from("files")
        .select("id, drive_file_id")
        .not("drive_file_id", "is", null);
      if (selErr) return json({ error: selErr.message }, 500);

      let updated = 0;
      let failed  = 0;
      for (const row of (rows ?? []) as Array<{ id: string; drive_file_id: string }>) {
        try {
          const r = await fetch(
            `https://www.googleapis.com/drive/v3/files/${row.drive_file_id}?fields=modifiedTime&supportsAllDrives=true`,
            { headers: { Authorization: `Bearer ${gtoken}` } },
          );
          if (!r.ok) { failed++; continue; }
          const meta = await r.json();
          if (!meta.modifiedTime) { failed++; continue; }
          const { error: upErr } = await sb
            .from("files")
            .update({ modified_at: meta.modifiedTime })
            .eq("id", row.id);
          if (upErr) { failed++; continue; }
          updated++;
        } catch {
          failed++;
        }
      }
      return json({ scanned: rows?.length ?? 0, updated, failed });
    }

    // ── download_bytes ────────────────────────────────────────
    // Returns a Drive file as base64 so the browser hook can render
    // thumbnails for Drive-sourced CAD files (STEP, STL, IGES, etc.).
    // Browser-side direct fetch fails because file_url is a /view HTML
    // page, not the file bytes.
    if (action === "download_bytes") {
      const { drive_file_id } = payload as { drive_file_id: string };
      if (!drive_file_id) return json({ error: "drive_file_id required" }, 400);

      const fileResp = await fetch(
        `https://www.googleapis.com/drive/v3/files/${drive_file_id}?alt=media&supportsAllDrives=true`,
        { headers: { Authorization: `Bearer ${gtoken}` } },
      );
      if (!fileResp.ok) {
        const body = await fileResp.text().catch(() => "");
        return json({ error: `Drive download failed: ${fileResp.status}`, body: body.slice(0, 200) }, 502);
      }
      const bytes = new Uint8Array(await fileResp.arrayBuffer());

      // Cap at 50 MB so we don't blow up the function memory or response.
      if (bytes.length > 50 * 1024 * 1024) {
        return json({ error: "file too large", size: bytes.length }, 413);
      }

      // Encode as base64 for JSON transport.
      let bin = "";
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      const b64 = btoa(bin);
      return json({ size: bytes.length, base64: b64 });
    }

    if (action === "rename_folder") {
      const { folder_id, new_name } = payload as { folder_id: string; new_name: string };
      const resp = await fetch(
        `https://www.googleapis.com/drive/v3/files/${folder_id}?supportsAllDrives=true&fields=id`,
        {
          method: "PATCH",
          headers: { Authorization: `Bearer ${gtoken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ name: new_name }),
        },
      );
      const data = await resp.json();
      if (!data.id) throw new Error(`Drive rename failed: ${JSON.stringify(data)}`);
      return json({ folder_id: data.id });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[google-drive]", msg);
    return json({ error: msg }, 500);
  }
});
