export function selectedAskActionLabel(
  answer: string,
  actions?: Array<{ id: string; label: string }>,
): string {
  return actions?.find((action) => action.id === answer)?.label ?? answer;
}
