import type { Skill } from "@/lib/roadmap";
import { SKILL_COLOR, SKILL_LABEL } from "@/lib/labels";

/** The tinted skill pill from the design export. */
export function SkillBadge({
  skill,
  size = "md",
}: {
  skill: Skill;
  size?: "sm" | "md";
}) {
  const color = SKILL_COLOR[skill];
  const small = size === "sm";

  return (
    <span
      className="inline-flex flex-none items-center gap-1.5 rounded-full font-medium"
      style={{
        color,
        background: `color-mix(in oklab, ${color} 13%, transparent)`,
        padding: small ? "3px 10px" : "4px 11px 4px 9px",
        fontSize: small ? "11.5px" : "12px",
      }}
    >
      {!small && (
        <span
          aria-hidden
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: "currentColor" }}
        />
      )}
      {SKILL_LABEL[skill]}
    </span>
  );
}
