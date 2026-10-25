import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  CircularProgress,
  IconButton,
  Paper,
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
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import RefreshIcon from "@mui/icons-material/Refresh";
import { useNavigate } from "react-router-dom";

import type { PlanRead } from "@/utils/planApi";
import { usePlanApi } from "@/utils/planApi";
import type { PlanPayload } from "@/utils/planningTypes";

const formatTimestamp = (value: string | undefined) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

function PlanManager() {
  const { createPlan, deletePlan, fetchPlans, updatePlan } = usePlanApi();
  const [plans, setPlans] = useState<PlanRead[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actioningId, setActioningId] = useState<number | null>(null);
  const navigate = useNavigate();

  const existingLabels = useMemo(
    () => new Set(plans.map((plan) => plan.label.trim().toLowerCase())),
    [plans],
  );

  const loadPlans = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchPlans();
      setPlans(data);
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load plans";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPlans();
  }, [loadPlans]);

  const handleRefresh = () => {
    void loadPlans();
  };

  const handleRename = async (plan: PlanRead) => {
    const nextLabel = window.prompt("Rename plan", plan.label);
    if (!nextLabel) return;
    const normalized = nextLabel.trim();
    if (!normalized || normalized.toLowerCase() === plan.label.trim().toLowerCase()) {
      return;
    }
    setActioningId(plan.id);
    try {
      await updatePlan(plan.id, { label: normalized });
      await loadPlans();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to rename plan";
      setError(message);
    } finally {
      setActioningId(null);
    }
  };

  const handleDuplicate = async (plan: PlanRead) => {
    setActioningId(plan.id);
    try {
      let suffix = 1;
      let candidate = `${plan.label} Copy`;
      while (existingLabels.has(candidate.trim().toLowerCase())) {
        suffix += 1;
        candidate = `${plan.label} Copy ${suffix}`;
      }
      await createPlan(candidate.trim(), plan.payload as PlanPayload);
      await loadPlans();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to duplicate plan";
      setError(message);
    } finally {
      setActioningId(null);
    }
  };

  const handleDelete = async (plan: PlanRead) => {
    if (!window.confirm(`Delete plan "${plan.label}"? This cannot be undone.`)) {
      return;
    }
    setActioningId(plan.id);
    try {
      await deletePlan(plan.id);
      await loadPlans();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to delete plan";
      setError(message);
    } finally {
      setActioningId(null);
    }
  };

  const handleLoad = (plan: PlanRead) => {
    navigate("/planning", { state: { savedPlan: plan } });
  };

  return (
    <Box sx={{ width: "100%", maxWidth: 900, display: "flex", flexDirection: "column", gap: 2 }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Typography variant="h5">Saved Plans</Typography>
        <Box sx={{ display: "flex", gap: 1 }}>
          <Button
            variant="outlined"
            size="small"
            startIcon={<RefreshIcon />}
            onClick={handleRefresh}
            disabled={loading}
          >
            Refresh
          </Button>
        </Box>
      </Box>
      {error && (
        <Paper sx={{ padding: 2, backgroundColor: (theme) => theme.palette.error.light }}>
          <Typography color="error.contrastText">{error}</Typography>
        </Paper>
      )}
      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Label</TableCell>
              <TableCell>Last Updated</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {plans.length === 0 && !loading ? (
              <TableRow>
                <TableCell colSpan={3} align="center">
                  <Typography variant="body2" color="text.secondary">
                    No saved plans yet. Head to the planning page to save one.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              plans.map((plan) => {
                const disabled = actioningId === plan.id;
                return (
                  <TableRow key={plan.id} hover>
                    <TableCell>{plan.label}</TableCell>
                    <TableCell>{formatTimestamp(plan.updated_at ?? plan.created_at)}</TableCell>
                    <TableCell align="right">
                      <Tooltip title="Load into planner">
                        <span>
                          <IconButton
                            aria-label="load plan"
                            onClick={() => handleLoad(plan)}
                            disabled={disabled}
                            size="small"
                          >
                            <OpenInNewIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip title="Rename">
                        <span>
                          <IconButton
                            aria-label="rename plan"
                            onClick={() => void handleRename(plan)}
                            disabled={disabled}
                            size="small"
                          >
                            <EditIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip title="Duplicate">
                        <span>
                          <IconButton
                            aria-label="duplicate plan"
                            onClick={() => void handleDuplicate(plan)}
                            disabled={disabled}
                            size="small"
                          >
                            <ContentCopyIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip title="Delete">
                        <span>
                          <IconButton
                            aria-label="delete plan"
                            onClick={() => void handleDelete(plan)}
                            disabled={disabled}
                            size="small"
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
        {loading && (
          <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", padding: 2 }}>
            <CircularProgress size={24} />
          </Box>
        )}
      </TableContainer>
    </Box>
  );
}

export default PlanManager;
