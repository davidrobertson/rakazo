import { BotAvatar, GroupAvatar, type GroupAvatarMember } from "@rakazo/ui-web";
import { LoadingState } from "./primitives";

/** Lightweight peer event shown without exposing the exchanged message body. */
export function CollaborationMarker({
  ariaLabel,
  color,
  identity,
  label,
  onClick,
}: {
  ariaLabel: string;
  color: string;
  identity: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-testid="peer-receipt-chip"
      aria-label={ariaLabel}
      onClick={onClick}
      className="flex items-center justify-start gap-1.5 self-start rounded-full px-2.5 py-1 text-[13px] text-[#85858A] transition-colors hover:bg-[#161618] hover:text-[#B8B8BD]"
    >
      <BotAvatar color={color} identity={identity} size={16} />
      <span dir="auto">{label}</span>
    </button>
  );
}

export function ActiveBotGlyph({ bots, label }: { bots: GroupAvatarMember[]; label: string }) {
  return (
    <div className="flex min-h-10 items-center px-1">
      <LoadingState indicator={<GroupAvatar members={bots} size={28} />} label={label} />
    </div>
  );
}
