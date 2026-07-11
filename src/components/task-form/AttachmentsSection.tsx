import { Link as LinkIcon, Paperclip, Upload, X } from "lucide-react";
import type React from "react";
import type { Attachment } from "../../../types";
import { getSafeExternalUrl } from "../../utils/safeUrl";
import { Tooltip } from "../Tooltip";

interface AttachmentsSectionProps {
  attachments: Attachment[];
  newLinkName: string;
  setNewLinkName: React.Dispatch<React.SetStateAction<string>>;
  newLinkUrl: string;
  setNewLinkUrl: React.Dispatch<React.SetStateAction<string>>;
  handleAddLink: () => void;
  handleFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleRemoveAttachment: (id: string) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
}

export const AttachmentsSection: React.FC<AttachmentsSectionProps> = ({
  attachments,
  newLinkName,
  setNewLinkName,
  newLinkUrl,
  setNewLinkUrl,
  handleAddLink,
  handleFileUpload,
  handleRemoveAttachment,
  fileInputRef,
}) => (
  <div className="space-y-3">
    <label className="text-xs font-bold text-slate-400 uppercase tracking-widest pl-1 flex items-center gap-2">
      <Paperclip size={12} /> Attachments
    </label>
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <input
          type="text"
          value={newLinkName}
          onChange={(e) => setNewLinkName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleAddLink();
            }
          }}
          placeholder="Link Name (Optional)"
          className="w-1/3 liquid-input rounded-xl px-4 py-2.5 text-sm"
          aria-label="Link name (optional)"
        />
        <input
          type="text"
          value={newLinkUrl}
          onChange={(e) => setNewLinkUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleAddLink();
            }
          }}
          placeholder="https://..."
          className="flex-1 liquid-input rounded-xl px-4 py-2.5 text-sm"
          aria-label="Link URL"
        />
        <Tooltip content="Add Link" position="top">
          <button
            type="button"
            onClick={handleAddLink}
            className="p-2.5 bg-white/5 hover:bg-white/10 rounded-xl text-slate-300 transition-colors border border-white/5"
            aria-label="Add link"
          >
            <LinkIcon size={18} aria-hidden="true" />
          </button>
        </Tooltip>
        <Tooltip content="Upload File" position="top">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="p-2.5 bg-white/5 hover:bg-white/10 rounded-xl text-slate-300 transition-colors border border-white/5"
            aria-label="Upload file"
          >
            <Upload size={18} aria-hidden="true" />
          </button>
        </Tooltip>
        <input
          type="file"
          ref={fileInputRef}
          className="hidden"
          onChange={handleFileUpload}
          aria-label="Upload file attachment"
        />
      </div>
    </div>
    <div className="max-h-32 overflow-y-auto space-y-2 custom-scrollbar pr-2">
      {attachments.map((att) => (
        <div
          key={att.id}
          className="flex items-center gap-3 p-2.5 rounded-xl bg-black/20 border border-white/5 group hover:border-white/10 transition-colors"
        >
          <div className="p-1.5 rounded-lg bg-white/5 text-slate-400">
            {att.type === "file" ? <Paperclip size={14} /> : <LinkIcon size={14} />}
          </div>

          {(() => {
            const safeUrl = att.type === "file" ? att.url : getSafeExternalUrl(att.url);
            const isSafe = Boolean(safeUrl);
            return (
              <Tooltip content={safeUrl ?? "Unsafe URL blocked"} position="top">
                <a
                  href={safeUrl ?? "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`flex-1 text-sm font-medium truncate underline decoration-red-500/30 hover:decoration-red-400 ${isSafe ? "text-red-400 hover:text-red-300" : "text-slate-500 cursor-not-allowed decoration-slate-500/30"}`}
                  onClick={(e) => !isSafe && e.preventDefault()}
                >
                  {att.name}
                </a>
              </Tooltip>
            );
          })()}
          <Tooltip content={`Remove attachment "${att.name}"`} position="top">
            <button
              type="button"
              onClick={() => handleRemoveAttachment(att.id)}
              className="text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 transition-all"
              aria-label={`Remove attachment "${att.name}"`}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </Tooltip>
        </div>
      ))}
    </div>
  </div>
);
