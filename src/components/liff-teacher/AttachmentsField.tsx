"use client";

import { useState } from "react";
import { Link2, Loader2, Paperclip, UploadCloud } from "lucide-react";
import { AttachmentCard, GoogleDriveMark } from "@/components/AssignmentAttachments";
import { optimizeImage, UploadError, uploadToStorage } from "@/lib/storage/uploadClient";
import { normalizeLink, uploadRejection } from "@/lib/storage/uploadRules";
import { googleAppName, isGoogleDriveUrl, linkDisplayName, MAX_ASSIGNMENT_ATTACHMENTS } from "@/lib/utils/referenceWork";
import type { AssignmentAttachment } from "@/types/database";
import { inputClass } from "./kit";

/** An attachment in the form; `file` = picked but not uploaded yet (url is a blob preview). */
export type AttachmentDraft = AssignmentAttachment & { uid: number; file?: File };

let nextUid = 1;

/**
 * Uploads the picked files (links pass through), as the website does on save.
 * Throws a message naming the file that failed; uploaded ones are reported
 * through onUploaded so a retry skips them.
 */
export async function uploadAttachments(list: AttachmentDraft[], onUploaded: (done: AttachmentDraft) => void): Promise<AssignmentAttachment[]> {
  const saved: AssignmentAttachment[] = [];
  for (const draft of list) {
    if (!draft.file) {
      saved.push({ kind: draft.kind, url: draft.url, name: draft.name });
      continue;
    }
    try {
      // Not saved yet: stored as the teacher's draft upload (a failed earlier try may already hold it).
      const uploaded = await uploadToStorage(draft.file, { assignmentId: "draft", optimized: true, onDuplicate: () => "reuse" });
      URL.revokeObjectURL(draft.url);
      const done: AttachmentDraft = { uid: draft.uid, kind: draft.kind, url: uploaded.url, name: draft.name };
      onUploaded(done);
      saved.push({ kind: done.kind, url: done.url, name: done.name });
    } catch (err) {
      const message = err instanceof UploadError ? err.message : "อัปโหลดไฟล์แนบไม่สำเร็จ";
      throw new Error(`${draft.name}: ${message}`);
    }
  }
  return saved;
}

/** "ไฟล์แนบ": web links, Google Drive links, images / PDFs (homework and quizzes, as on the website). */
export function AttachmentsField({
  isExam,
  attachments,
  setAttachments,
  busy,
}: {
  isExam: boolean;
  attachments: AttachmentDraft[];
  setAttachments: React.Dispatch<React.SetStateAction<AttachmentDraft[]>>;
  /** Saving: files are uploading, so nothing may be removed. */
  busy: boolean;
}) {
  const [linkKind, setLinkKind] = useState<null | "link" | "drive">(null);
  const [linkInput, setLinkInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const slots = MAX_ASSIGNMENT_ATTACHMENTS - attachments.length;

  const openLink = (kind: "link" | "drive") => {
    setLinkKind(kind);
    setLinkInput("");
    setError(null);
  };

  const addLink = () => {
    const url = normalizeLink(linkInput);
    if (!url) return setError("ลิงก์ไม่ถูกต้อง กรุณาวางลิงก์ที่ขึ้นต้นด้วย https://");
    const drive = isGoogleDriveUrl(url);
    if (linkKind === "drive" && !drive) return setError("ลิงก์นี้ไม่ใช่ Google Drive ใช้ปุ่ม “ลิงก์” สำหรับเว็บไซต์อื่น");
    if (attachments.some((a) => a.url === url)) return setError("แนบลิงก์นี้ไว้แล้ว");
    setAttachments((list) =>
      [...list, { uid: nextUid++, kind: drive ? ("drive" as const) : ("link" as const), url, name: drive ? googleAppName(url) : linkDisplayName(url) }].slice(0, MAX_ASSIGNMENT_ATTACHMENTS)
    );
    setLinkKind(null);
    setError(null);
  };

  const addFiles = async (picked: File[]) => {
    setError(null);
    if (picked.length > slots) setError(`แนบได้สูงสุด ${MAX_ASSIGNMENT_ATTACHMENTS} รายการ เพิ่มได้อีก ${slots} รายการ`);
    // Large photos are shrunk without visible loss; anything still over the limit should be a Drive link.
    setPreparing(true);
    const added: AttachmentDraft[] = [];
    try {
      for (const original of picked.slice(0, Math.max(slots, 0))) {
        const file = await optimizeImage(original);
        const rejection = uploadRejection(file);
        if (rejection) {
          setError(`${original.name}: ${rejection}`);
          continue;
        }
        added.push({ uid: nextUid++, kind: file.type === "application/pdf" ? "file" : "image", url: URL.createObjectURL(file), name: original.name, file });
      }
    } finally {
      setPreparing(false);
    }
    if (added.length) setAttachments((list) => [...list, ...added].slice(0, MAX_ASSIGNMENT_ATTACHMENTS));
  };

  const remove = (uid: number) => {
    setAttachments((list) => {
      const gone = list.find((a) => a.uid === uid);
      if (gone?.file) URL.revokeObjectURL(gone.url);
      return list.filter((a) => a.uid !== uid);
    });
    setError(null);
  };

  const buttonClass =
    "h-10 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-bold text-slate-700 dark:text-slate-200 inline-flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 transition-transform";

  return (
    <div className="space-y-2">
      <p className="text-xs font-bold text-slate-600 dark:text-slate-300 flex items-center gap-1">
        <Paperclip className="w-3.5 h-3.5 text-amber-500" /> ไฟล์แนบ
        <span className="font-semibold text-slate-400">({attachments.length}/{MAX_ASSIGNMENT_ATTACHMENTS})</span>
      </p>
      {isExam && <p className="text-[11px] text-slate-500">รูปภาพและ PDF นักเรียนเปิดดูในหน้าข้อสอบได้ • การเปิดลิงก์จะนับเป็นการออกจากหน้าจอ</p>}
      {attachments.length > 0 && (
        <div className="space-y-1.5">
          {attachments.map((a) => (
            <AttachmentCard
              key={a.uid}
              attachment={a}
              size="sm"
              busy={!!a.file && busy}
              note={a.file ? "จะอัปโหลดเมื่อบันทึกงาน" : undefined}
              onRemove={busy ? undefined : () => remove(a.uid)}
            />
          ))}
        </div>
      )}
      {slots > 0 && (
        <div className="grid grid-cols-3 gap-2">
          <button type="button" className={buttonClass} onClick={() => openLink("link")}>
            <Link2 className="w-4 h-4 text-sky-600" /> ลิงก์
          </button>
          <button type="button" className={buttonClass} onClick={() => openLink("drive")}>
            <GoogleDriveMark className="w-4 h-4" /> Drive
          </button>
          <label className={`${buttonClass} ${preparing ? "opacity-60 cursor-wait" : ""}`}>
            {preparing ? <Loader2 className="w-4 h-4 animate-spin text-amber-600" /> : <UploadCloud className="w-4 h-4 text-amber-600" />} รูป / PDF
            <input
              type="file"
              multiple
              accept="application/pdf,image/*"
              disabled={preparing || busy}
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files || []);
                e.target.value = "";
                if (files.length) void addFiles(files);
              }}
            />
          </label>
        </div>
      )}
      {linkKind && slots > 0 && (
        <div className="space-y-1.5">
          {linkKind === "drive" && <p className="text-[11px] text-slate-500">คัดลอกลิงก์จากปุ่ม “แชร์” ใน Drive แล้ววางที่นี่ ตั้งค่าเป็น “ทุกคนที่มีลิงก์”</p>}
          <div className="flex gap-2">
            <input
              className={inputClass}
              type="url"
              inputMode="url"
              autoFocus
              placeholder={linkKind === "drive" ? "https://drive.google.com/..." : "https://..."}
              value={linkInput}
              onChange={(e) => {
                setLinkInput(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addLink();
                }
              }}
            />
            <button type="button" onClick={addLink} className="h-11 px-3 shrink-0 rounded-xl bg-amber-500 text-slate-950 text-xs font-bold cursor-pointer">
              แนบ
            </button>
            <button type="button" onClick={() => setLinkKind(null)} className="h-11 px-2 shrink-0 rounded-xl text-xs font-bold text-slate-500 cursor-pointer">
              ยกเลิก
            </button>
          </div>
        </div>
      )}
      {error && <p className="text-[11px] text-rose-500 font-semibold">{error}</p>}
      <p className="text-[11px] text-slate-400">
        {slots > 0 ? `สูงสุด ${MAX_ASSIGNMENT_ATTACHMENTS} รายการ • รูป ≤5MB, PDF ≤10MB (ใหญ่กว่านี้ใช้ลิงก์ Drive)` : `แนบครบ ${MAX_ASSIGNMENT_ATTACHMENTS} รายการแล้ว นำออกเพื่อเพิ่มรายการใหม่`}
      </p>
    </div>
  );
}
