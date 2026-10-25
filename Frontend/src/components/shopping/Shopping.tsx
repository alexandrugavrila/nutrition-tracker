import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Select,
  Snackbar,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import EditIcon from "@mui/icons-material/Edit";
import FileDownloadIcon from "@mui/icons-material/FileDownload";

import { useData } from "@/contexts/DataContext";
import { useAccountClient } from "@/contexts/AccountScope";
import { useSessionStorageState } from "@/hooks/useSessionStorageState";
import type { PlanItem } from "@/utils/planningTypes";
import { aggregateShoppingList } from "@/utils/shopping";
import type { ShoppingListItem, ShoppingListUnitTotal } from "@/utils/shopping";
import { formatCellNumber } from "@/utils/utils";
import IngredientModal from "@/components/common/IngredientModal";
import type { components } from "@/api-types";
import useHoverable from "@/hooks/useHoverable";

type IngredientRead = components["schemas"]["IngredientRead"];
type IngredientWithSelection = IngredientRead & {
  shoppingUnitId?: number | string | null;
};

type HoverableEditWrapperProps = {
  onEdit: () => void;
  children: React.ReactNode;
};

const HoverableEditWrapper: React.FC<HoverableEditWrapperProps> = ({
  onEdit,
  children,
}) => {
  const { hovered, bind } = useHoverable();

  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }} {...bind}>
      {children}
      {hovered && (
        <Tooltip title="Edit ingredient (add units, nutrition, tags)">
          <IconButton size="small" aria-label="edit ingredient" onClick={onEdit}>
            <EditIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )}
    </Box>
  );
};

type ActivePlanState = {
  id: number | null;
  label: string | null;
  updatedAt: string | null;
};

const CLEAR_SELECTION_VALUE = "__CLEAR_SHOPPING_UNIT__";
const NULL_UNIT_SENTINEL = "__NULL_UNIT__";

const getShoppingItemKey = (item: ShoppingListItem): string => {
  if (item.ingredientId !== null && item.ingredientId !== undefined) {
    return `ingredient:${String(item.ingredientId)}`;
  }

  const normalizedName = item.name?.trim();
  if (normalizedName) {
    return `name:${normalizedName}`;
  }

  const fallbackId = item.ingredient?.id;
  if (fallbackId !== null && fallbackId !== undefined) {
    return `ingredient:${String(fallbackId)}`;
  }

  return `ingredient:${JSON.stringify(item.ingredient)}`;
};

const toOptionValue = (
  unitId: number | string | null | undefined,
): string => {
  if (unitId === NULL_UNIT_SENTINEL) {
    return NULL_UNIT_SENTINEL;
  }
  if (unitId === null || unitId === undefined) {
    return NULL_UNIT_SENTINEL;
  }
  return String(unitId);
};

const resolvePlanFallbackSelection = (
  item: ShoppingListItem,
): string => {
  const preferredUnitId = item.preferredUnitTotal?.unitId;
  if (preferredUnitId !== null && preferredUnitId !== undefined) {
    return toOptionValue(preferredUnitId);
  }

  const firstAvailableUnit =
    item.unitTotals.find((unit) => unit.unitId !== null && unit.unitId !== undefined) ??
    item.unitTotals[0];

  if (firstAvailableUnit) {
    return toOptionValue(firstAvailableUnit.unitId);
  }

  return CLEAR_SELECTION_VALUE;
};

const deriveSelectionValue = (
  selection: number | string | null | undefined,
  fallback: string,
): string => {
  if (selection === NULL_UNIT_SENTINEL) {
    return NULL_UNIT_SENTINEL;
  }
  if (
    selection === null ||
    selection === undefined ||
    selection === CLEAR_SELECTION_VALUE ||
    (typeof selection === "string" && selection.trim() === "")
  ) {
    return fallback;
  }
  return String(selection);
};

function Shopping() {
  const apiClient = useAccountClient();
  const {
    foods,
    ingredients,
    hydrating,
    setIngredients,
    setIngredientsNeedsRefetch,
    startRequest,
    endRequest,
  } = useData();
  const [modalState, setModalState] = useState<{
    open: boolean;
    ingredient: IngredientWithSelection | null;
  }>({ open: false, ingredient: null });
  const [plan] = useSessionStorageState<PlanItem[]>("planning-plan", () => []);
  const [days] = useSessionStorageState<number>("planning-days", 1);
  const [activePlan] = useSessionStorageState<ActivePlanState>(
    "planning-active-plan",
    () => ({ id: null, label: null, updatedAt: null }),
  );

  const { items, issues } = useMemo(
    () => aggregateShoppingList({ plan, foods, ingredients }),
    [plan, foods, ingredients],
  );

  const [exportAnchorEl, setExportAnchorEl] = useState<null | HTMLElement>(null);
  const [exportFeedback, setExportFeedback] = useState<{
    open: boolean;
    message: string;
    severity: "success" | "error";
  }>({ open: false, message: "", severity: "success" });
  const [excludedItems, setExcludedItems] = useSessionStorageState<Record<string, boolean>>(
    "shopping-excluded-items",
    () => ({}),
  );

  useEffect(() => {
    setExcludedItems((previous) => {
      const validKeys = new Set(items.map((item) => getShoppingItemKey(item)));
      let changed = false;
      const next: Record<string, boolean> = {};

      Object.entries(previous).forEach(([key, value]) => {
        if (validKeys.has(key) && value) {
          next[key] = true;
        } else if (!validKeys.has(key)) {
          changed = true;
        }
      });

      return changed || Object.keys(previous).length !== Object.keys(next).length
        ? next
        : previous;
    });
  }, [items, setExcludedItems]);

  const toggleItemExclusion = useCallback(
    (itemKey: string) => {
      setExcludedItems((previous) => {
        const next = { ...previous };
        if (next[itemKey]) {
          delete next[itemKey];
        } else {
          next[itemKey] = true;
        }
        return next;
      });
    },
    [setExcludedItems],
  );

  const ingredientLookup = useMemo(() => {
    const map = new Map<string, IngredientWithSelection>();
    ingredients.forEach((ingredient) => {
      if (ingredient && ingredient.id !== null && ingredient.id !== undefined) {
        map.set(String(ingredient.id), ingredient as IngredientWithSelection);
      }
    });
    return map;
  }, [ingredients]);

  const parseSelectionValue = useCallback((value: unknown): number | string | null => {
    if (value === CLEAR_SELECTION_VALUE) return null;
    if (value === NULL_UNIT_SENTINEL) return NULL_UNIT_SENTINEL;
    if (value === null || value === undefined) return null;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed === "") return null;
      const numeric = Number(trimmed);
      if (Number.isFinite(numeric)) return numeric;
      return trimmed;
    }
    return null;
  }, []);

  const handlePreferredUnitChange = useCallback(
    async (ingredientId: number | null | undefined, value: unknown) => {
      if (ingredientId === null || ingredientId === undefined) return;
      const lookupKey = String(ingredientId);
      const ingredient = ingredientLookup.get(lookupKey);
      if (!ingredient) return;
      const parsed = parseSelectionValue(value);

      setIngredients((prev) =>
        prev.map((existing) =>
          existing.id === ingredientId
            ? ({ ...existing, shoppingUnitId: parsed } as IngredientWithSelection)
            : existing,
        ),
      );

      startRequest();
      try {
        const selected = ingredient.units?.find(unit => String(unit.id) === String(parsed));
        const legacyGram = parsed === NULL_UNIT_SENTINEL ? ingredient.units?.find(unit => unit.id != null && Number(unit.grams) === 1) : undefined;
        const payload = { unit_id: selected?.id ?? legacyGram?.id ?? null };
        await apiClient
          .path(`/api/ingredients/${ingredientId}/shopping-preference`)
          .method("put")
          .create()({ body: payload });
        setIngredientsNeedsRefetch(true);
      } catch (error) {
        console.error("Failed to update shopping unit", error);
        setIngredientsNeedsRefetch(true);
      } finally {
        endRequest();
      }
    },
    [
      ingredientLookup,
      parseSelectionValue,
      setIngredients,
      startRequest,
      setIngredientsNeedsRefetch,
      endRequest,
    ],
  );

  const openIngredientModal = useCallback((ingredient: IngredientWithSelection) => {
    setModalState({ open: true, ingredient });
  }, []);

  const closeIngredientModal = useCallback(() => {
    setModalState({ open: false, ingredient: null });
  }, []);

  const planIsEmpty = !plan || plan.length === 0;
  const normalizedDays = Number.isFinite(days) && days > 0 ? days : 1;
  const planLabel = activePlan.label?.trim()
    ? `Based on plan "${activePlan.label}"`
    : "Based on current plan";

  const resolveItemDetails = useCallback(
    (item: ShoppingListItem) => {
      const ingredientId =
        typeof item.ingredient.id === "number"
          ? item.ingredient.id
          : item.ingredient.id != null
          ? Number(item.ingredient.id)
          : null;

      const contextIngredient =
        (ingredientId != null
          ? ingredientLookup.get(String(ingredientId))
          : null) ?? (item.ingredient as IngredientWithSelection);

      const fallbackSelectValue = resolvePlanFallbackSelection(item);
      const selectValue = deriveSelectionValue(
        contextIngredient.shoppingUnitId,
        fallbackSelectValue,
      );

      const selectedUnitTotal = item.unitTotals.find(
        (unit) => toOptionValue(unit.unitId) === selectValue,
      );

      const displayUnitTotal: ShoppingListUnitTotal | null =
        selectedUnitTotal ??
        item.preferredUnitTotal ??
        item.unitTotals[0] ??
        null;

      const unitName = displayUnitTotal?.unitName?.trim() ?? "";
      const quantityLabel = displayUnitTotal
        ? unitName
          ? `${formatCellNumber(displayUnitTotal.quantity)} ${unitName}`
          : `${formatCellNumber(displayUnitTotal.quantity)}`
        : "—";

      return {
        ingredientId,
        contextIngredient,
        selectValue,
        displayUnitTotal,
        quantityLabel,
      };
    },
    [ingredientLookup],
  );

  const exportRows = useMemo(
    () =>
      items
        .filter((item) => !excludedItems[getShoppingItemKey(item)])
        .map((item) => {
          const { displayUnitTotal } = resolveItemDetails(item);
          const unitName = displayUnitTotal?.unitName?.trim() ?? "";
          const quantityValue = displayUnitTotal
            ? formatCellNumber(displayUnitTotal.quantity)
            : "";
          const textParts = [quantityValue, unitName, item.name]
            .map((part) => (part == null ? "" : String(part).trim()))
            .filter((part) => part !== "");
          const textLine = textParts.join(" ") || String(item.name ?? "");

          return {
            name: item.name,
            quantityValue,
            unitName,
            textLine,
          };
        }),
    [excludedItems, items, resolveItemDetails],
  );

  const handleExportMenuOpen = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      setExportAnchorEl(event.currentTarget);
    },
    [],
  );

  const handleExportMenuClose = useCallback(() => {
    setExportAnchorEl(null);
  }, []);

  const showExportFeedback = useCallback((
    message: string,
    severity: "success" | "error",
  ) => {
    setExportFeedback({ open: true, message, severity });
  }, []);

  const handleExportText = useCallback(async () => {
    setExportAnchorEl(null);
    const text = exportRows.map((row) => row.textLine).join("\n");

    if (!text) {
      showExportFeedback("Nothing to copy", "error");
      return;
    }

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        showExportFeedback("Shopping list copied to clipboard", "success");
        return;
      }

      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const successful = document.execCommand("copy");
      document.body.removeChild(textarea);

      if (successful) {
        showExportFeedback("Shopping list copied to clipboard", "success");
      } else {
        throw new Error("Copy command was unsuccessful");
      }
    } catch (error) {
      console.error("Failed to copy shopping list", error);
      showExportFeedback("Failed to copy shopping list", "error");
    }
  }, [exportRows, showExportFeedback]);

  const handleExportCsv = useCallback(() => {
    setExportAnchorEl(null);

    if (exportRows.length === 0) {
      showExportFeedback("Nothing to export", "error");
      return;
    }

    try {
      const header = ["Ingredient", "Quantity", "Unit"];
      const csvLines = [header, ...exportRows.map((row) => [
        row.name,
        row.quantityValue,
        row.unitName,
      ])]
        .map((line) =>
          line
            .map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`)
            .join(","),
        )
        .join("\n");

      const blob = new Blob([csvLines], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const timestamp = new Date().toISOString().split("T")[0];
      link.download = `shopping-list-${timestamp}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      showExportFeedback("Shopping list CSV downloaded", "success");
    } catch (error) {
      console.error("Failed to export shopping list CSV", error);
      showExportFeedback("Failed to download CSV", "error");
    }
  }, [exportRows, showExportFeedback]);

  const handleExportFeedbackClose = useCallback(
    (_event?: React.SyntheticEvent | Event, reason?: string) => {
      if (reason === "clickaway") {
        return;
      }
      setExportFeedback((prev) => ({ ...prev, open: false }));
    },
    [],
  );

  let content: React.ReactNode;
  if (hydrating) {
    content = (
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, mt: 3 }}>
        <CircularProgress />
        <Typography>Loading data needed for your shopping list…</Typography>
      </Box>
    );
  } else if (planIsEmpty) {
    content = (
      <Alert severity="info" sx={{ mt: 3 }}>
        Build a plan in the Planning tab to see the combined shopping list here.
      </Alert>
    );
  } else if (items.length === 0) {
    content = (
      <Alert severity="warning" sx={{ mt: 3 }}>
        We could not build a shopping list because some ingredients or foods are
        missing required data.
        {issues.length > 0 && (
          <Box component="ul" sx={{ mt: 1, pl: 3 }}>
            {issues.map((issue, index) => (
              <li key={`${issue.type}-${index}`}>{issue.message}</li>
            ))}
          </Box>
        )}
      </Alert>
    );
  } else {
    content = (
      <Box sx={{ mt: 3 }}>
        <TableContainer
          component={Paper}
          sx={{ width: { xs: "100%", sm: "fit-content" }, maxWidth: "100%", mx: "auto" }}
        >
          <Table>
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox" align="center">
                  Status
                </TableCell>
                <TableCell>Ingredient</TableCell>
                <TableCell>Shopping Unit</TableCell>
                <TableCell align="right">Need to Buy</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map((item) => {
                const { ingredientId, contextIngredient, selectValue, quantityLabel } =
                  resolveItemDetails(item);
                const itemKey = getShoppingItemKey(item);
                const isExcluded = Boolean(excludedItems[itemKey]);

                return (
                  <TableRow
                    key={itemKey}
                    sx={
                      isExcluded
                        ? {
                            '& .MuiTableCell-root': { color: "text.disabled" },
                            '& .MuiTypography-root': { color: "text.disabled" },
                            '& .MuiSelect-select': { color: "text.disabled !important" },
                            '& .MuiSvgIcon-root': { color: "text.disabled" },
                          }
                        : undefined
                    }
                  >
                    <TableCell padding="checkbox" align="center">
                      <Tooltip
                        title={
                          isExcluded ? "Mark as needed for this trip" : "Mark as already have"
                        }
                      >
                        <Checkbox
                          color="primary"
                          checked={!isExcluded}
                          onChange={() => toggleItemExclusion(itemKey)}
                          slotProps={{
                            input: {
                              "aria-label": isExcluded
                                ? `Mark ${item.name} as needed`
                                : `Mark ${item.name} as already have`,
                            },
                          }}
                        />
                      </Tooltip>
                    </TableCell>
                    <TableCell>
                      <HoverableEditWrapper
                        onEdit={() => openIngredientModal(contextIngredient)}
                      >
                        <Typography component="span">{item.name}</Typography>
                      </HoverableEditWrapper>
                    </TableCell>
                    <TableCell>
                      <Select
                        size="small"
                        value={selectValue}
                        onChange={(event) =>
                          handlePreferredUnitChange(
                            ingredientId,
                            event.target.value,
                          )
                        }
                      >
                        {(contextIngredient.units ?? []).map((unit) => {
                          const optionValue = toOptionValue(unit.id);
                          return (
                            <MenuItem
                              key={`${optionValue}-${unit.name}`}
                              value={optionValue}
                            >
                              {unit.name}
                            </MenuItem>
                          );
                        })}
                      </Select>
                    </TableCell>
                    <TableCell align="right">
                      <Typography component="span">{quantityLabel}</Typography>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      <Box
        sx={{
          display: "flex",
          flexDirection: { xs: "column", sm: "row" },
          justifyContent: "space-between",
          alignItems: { xs: "flex-start", sm: "center" },
          gap: 2,
        }}
      >
        <Box>
          <Typography variant="h4" component="h1">
            Shopping List
          </Typography>
          <Typography variant="subtitle1" sx={{ mt: 1 }}>
            {planLabel}
            {normalizedDays > 1 ? ` • ${normalizedDays} days` : ""}
          </Typography>
        </Box>
        {!hydrating && !planIsEmpty && items.length > 0 && (
          <Button
            variant="contained"
            startIcon={<FileDownloadIcon />}
            onClick={handleExportMenuOpen}
          >
            Export
          </Button>
        )}
      </Box>
      <Menu
        anchorEl={exportAnchorEl}
        open={Boolean(exportAnchorEl)}
        onClose={handleExportMenuClose}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        <MenuItem onClick={handleExportText}>
          <ListItemIcon>
            <ContentCopyIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Copy as text</ListItemText>
        </MenuItem>
        <MenuItem onClick={handleExportCsv}>
          <ListItemIcon>
            <FileDownloadIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Download CSV</ListItemText>
        </MenuItem>
      </Menu>
      {content}
      {!hydrating && !planIsEmpty && items.length > 0 && issues.length > 0 && (
        <Alert severity="warning" sx={{ mt: 3 }}>
          Some items could not be combined:
          <Box component="ul" sx={{ mt: 1, pl: 3, mb: 0 }}>
            {issues.map((issue, index) => (
              <li key={`${issue.type}-${index}`}>{issue.message}</li>
            ))}
          </Box>
        </Alert>
      )}
      <IngredientModal
        open={modalState.open}
        mode="edit"
        ingredient={modalState.ingredient ?? null}
        onClose={closeIngredientModal}
      />
      <Snackbar
        open={exportFeedback.open}
        autoHideDuration={4000}
        onClose={handleExportFeedbackClose}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert
          onClose={handleExportFeedbackClose}
          severity={exportFeedback.severity}
          sx={{ width: "100%" }}
        >
          {exportFeedback.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}

export default Shopping;
