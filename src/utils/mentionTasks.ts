// Universal @mention → staff task pipeline.
//
// Call processMentions() after any comment / chat / note is submitted anywhere
// in the portal. If the text contains @Name mentions of staff, the
// mention-to-task edge function resolves them against profiles, composes a
// task (title + description) from the text AND the captured screen context,
// inserts it into staff_tasks assigned to the mentioned person, and pings
// them via Google Chat. Fire-and-forget safe — never throws.

import { supabase } from '../lib/supabase'
import { captureScreen } from './captureScreen'

// Word boundary before '@' so email addresses don't trigger an invocation.
const MENTION_RE = /(^|[^A-Za-z0-9._%+-])@[A-Za-z]/

export interface MentionSource {
  /** Where the text was written, e.g. 'Comment on task "Fix freight rates"' */
  label: string
  /** Portal-relative or absolute link back to the source */
  url?: string
}

export interface CreatedMentionTask {
  task_id: string
  title: string
  assignee: string
}

export async function processMentions(
  text: string,
  source: MentionSource,
): Promise<CreatedMentionTask[]> {
  if (!text || !MENTION_RE.test(text)) return []
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user?.email) return []
    const { data, error } = await supabase.functions.invoke('mention-to-task', {
      body: {
        text,
        source,
        screen: captureScreen(),
        userEmail: user.email,
      },
    })
    if (error) throw error
    return (data?.created ?? []) as CreatedMentionTask[]
  } catch (err) {
    console.warn('[mention-to-task]', err)
    return []
  }
}
