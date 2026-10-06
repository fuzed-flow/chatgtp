import { toast } from "sonner";
import { normalizePhaseOrder } from "@/lib/phaseOrdering";

export const usePhaseFunctions = (phases, setPhases, onAutoSave = null) => {
  const duplicatePhase = (idx) => {
    const phaseToDuplicate = phases[idx];
    const duplicatedPhase = {
      ...phaseToDuplicate,
      id: `temp-phase-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      phase_name: `${phaseToDuplicate.phase_name} (Copy)`,
      sort_order: phases.length,
      items: phaseToDuplicate.items?.map(item => ({ ...item, id: `temp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}` })) || []
    };
    setPhases(current => normalizePhaseOrder([...current, duplicatedPhase]));
    toast.success("Phase duplicated");
  };

  const reorderLineItems = (phaseIdx, sourceIdx, destIdx) => {
    const updated = [...phases];
    const items = [...updated[phaseIdx].items];
    const [removed] = items.splice(sourceIdx, 1);
    items.splice(destIdx, 0, removed);
    updated[phaseIdx] = { ...updated[phaseIdx], items };
    setPhases(updated);
    if (onAutoSave) {
      setTimeout(() => onAutoSave(), 100);
    }
  };

  const reorderPhases = (sourceIdx, destIdx) => {
    setPhases(current => {
      const updated = [...current];
      const [removed] = updated.splice(sourceIdx, 1);
      updated.splice(destIdx, 0, removed);
      return normalizePhaseOrder(updated);
    });
  };

  return { duplicatePhase, reorderLineItems, reorderPhases };
};
