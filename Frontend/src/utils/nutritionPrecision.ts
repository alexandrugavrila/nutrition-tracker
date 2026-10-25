export const roundNutritionValue = (value: number | null | undefined): number | null => {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round((value + Number.EPSILON) * 100) / 100;
};
export const formatNutritionValue = (value: number | null | undefined): string => {
  const rounded = roundNutritionValue(value);
  return rounded === null ? "Unavailable" : String(rounded);
};
