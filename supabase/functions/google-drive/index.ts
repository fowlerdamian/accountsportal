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
        `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType,size,webViewLink)&supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=allDrives&pageSize=1000`,
        { headers: { Authorization: `Bearer ${gtoken}` } },
      );
      const listData = await listResp.json();
      console.log("[sync_from_drive] folder:", folder_id, "status:", listResp.status, "files:", listData.files?.length ?? 0, listData.error ? JSON.stringify(listData.error) : "");
      const driveFiles: Array<{ id: string; name: string; mimeType: string; size?: string; webViewLink: string }> =
        listData.files ?? [];

      if (driveFiles.length === 0) return json({ synced: 0, debug: listData.error ?? null });

      const { data: existing } = await sb
        .from("files")
        .select("drive_file_id")
        .eq("project_id", project_id)
        .not("drive_file_id", "is", null);

      const existingIds = new Set((existing ?? []).map((f: { drive_file_id: string }) => f.drive_file_id));
      const newFiles = driveFiles.filter((f) => !existingIds.has(f.id));
      if (newFiles.length === 0) return json({ synced: 0 });

      await sb.from("files").insert(
        newFiles.map((f) => ({
          project_id,
          filename:      f.name,
          file_url:      f.webViewLink,
          file_size:     f.size ? parseInt(f.size, 10) : null,
          mime_type:     f.mimeType || "application/octet-stream",
          source:        "drive",
          drive_file_id: f.id,
        })),
      );

      return json({ synced: newFiles.length });
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
      const { db_file_id, drive_file_id } = payload as { db_file_id: string; drive_file_id: string };

      let thumbBytes: Uint8Array | null = null;
      let thumbMime = "image/jpeg";

      // Download file and scan for embedded image in OLE binary (SLDPRT etc.)
      // Google Drive does not generate thumbnails for CAD files.
      const fileResp = await fetch(
        `https://www.googleapis.com/drive/v3/files/${drive_file_id}?alt=media&supportsAllDrives=true`,
        { headers: { Authorization: `Bearer ${gtoken}` } },
      );
      console.log("[get_thumbnail] file download status:", fileResp.status, "size:", fileResp.headers.get("content-length"));
      if (!fileResp.ok) return json({ skipped: true });

      const raw = new Uint8Array(await fileResp.arrayBuffer());
      const view = new DataView(raw.buffer);
      console.log("[get_thumbnail] raw bytes:", raw.length);

      // 1. Scan for JPEG (FF D8 FF)
      for (let i = 0; i < raw.length - 3; i++) {
        if (raw[i] === 0xFF && raw[i + 1] === 0xD8 && raw[i + 2] === 0xFF) {
          let lastEoi = -1;
          for (let j = i + 4; j < raw.length - 1; j++) {
            if (raw[j] === 0xFF && raw[j + 1] === 0xD9) lastEoi = j;
          }
          if (lastEoi > i) {
            thumbBytes = raw.slice(i, lastEoi + 2);
            thumbMime = "image/jpeg";
            console.log("[get_thumbnail] JPEG at offset", i, "size", thumbBytes.length);
            break;
          }
        }
      }

      // 2. Scan for PNG (89 50 4E 47)
      if (!thumbBytes) {
        for (let i = 0; i < raw.length - 8; i++) {
          if (raw[i] === 0x89 && raw[i+1] === 0x50 && raw[i+2] === 0x4E && raw[i+3] === 0x47) {
            for (let j = i + 8; j < raw.length - 8; j++) {
              if (raw[j] === 0x49 && raw[j+1] === 0x45 && raw[j+2] === 0x4E && raw[j+3] === 0x44 &&
                  raw[j+4] === 0xAE && raw[j+5] === 0x42 && raw[j+6] === 0x60 && raw[j+7] === 0x82) {
                thumbBytes = raw.slice(i, j + 8);
                thumbMime = "image/png";
                console.log("[get_thumbnail] PNG at offset", i, "size", thumbBytes.length);
                break;
              }
            }
            if (thumbBytes) break;
          }
        }
      }

      // 3. Scan for CF_DIB / BITMAPINFOHEADER (biSize = 40 = 0x28 in LE)
      // SolidWorks stores a preview bitmap in the OLE SummaryInformation stream.
      if (!thumbBytes) {
        for (let i = 512; i < raw.length - 54; i++) {
          if (raw[i] !== 0x28 || raw[i+1] !== 0x00 || raw[i+2] !== 0x00 || raw[i+3] !== 0x00) continue;
          const w   = view.getInt32(i + 4,  true);
          const h   = view.getInt32(i + 8,  true);
          const pl  = view.getUint16(i + 12, true);
          const bc  = view.getUint16(i + 14, true);
          const cmp = view.getUint32(i + 16, true);
          const cu  = view.getUint32(i + 32, true);
          if (w < 1 || w > 4096 || Math.abs(h) < 1 || Math.abs(h) > 4096) continue;
          if (pl !== 1 || ![1,4,8,16,24,32].includes(bc) || cmp > 1) continue;
          const ctEntries = bc <= 8 ? (cu > 0 ? cu : (1 << bc)) : 0;
          const ctSize    = ctEntries * 4;
          const rowBytes  = Math.ceil(w * bc / 32) * 4;
          const pixSize   = rowBytes * Math.abs(h);
          const dibSize   = 40 + ctSize + pixSize;
          if (i + dibSize > raw.length) continue;
          const pxOff = 14 + 40 + ctSize;
          const bmp = new Uint8Array(14 + dibSize);
          const bv  = new DataView(bmp.buffer);
          bmp[0] = 0x42; bmp[1] = 0x4D;
          bv.setUint32(2,  14 + dibSize, true);
          bv.setUint32(6,  0,            true);
          bv.setUint32(10, pxOff,        true);
          bmp.set(raw.slice(i, i + dibSize), 14);
          thumbBytes = bmp;
          thumbMime  = "image/bmp";
          console.log("[get_thumbnail] DIB at offset", i, "w", w, "h", h, "bc", bc, "size", dibSize);
          break;
        }
      }

      if (!thumbBytes) {
        console.log("[get_thumbnail] no image found in file");
        return json({ skipped: true });
      }

      // Upload to Supabase Storage
      const ext = thumbMime === "image/png" ? "png" : thumbMime === "image/bmp" ? "bmp" : "jpg";
      const path = `file-thumbnails/${db_file_id}.${ext}`;
      const { error: upErr } = await sb.storage
        .from("contractor-hub-files")
        .upload(path, thumbBytes, { contentType: thumbMime, upsert: true });
      if (upErr) return json({ error: upErr.message }, 500);

      const { data: { publicUrl } } = sb.storage.from("contractor-hub-files").getPublicUrl(path);
      await sb.from("files").update({ thumbnail_url: publicUrl }).eq("id", db_file_id);

      return json({ thumbnail_url: publicUrl });
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
