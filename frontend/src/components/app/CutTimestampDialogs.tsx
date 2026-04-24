import { TimestampDialog } from "../dialogs/TimestampDialog";

interface CutTimestampDialogsProps {
  showCutEditDialog: boolean;
  editingCutId: string | null;
  editCutStartMinutes: string;
  editCutStartSeconds: string;
  editCutEndMinutes: string;
  editCutEndSeconds: string;
  showAddManualCutDialog: boolean;
  onCloseEditCutDialog: () => void;
  onSaveEditedCut: (startValue: number, endValue: number) => Promise<void>;
  onCloseAddManualCutDialog: () => void;
  onSaveManualCut: (startValue: number, endValue: number) => Promise<void>;
}

export function CutTimestampDialogs({
  showCutEditDialog,
  editingCutId,
  editCutStartMinutes,
  editCutStartSeconds,
  editCutEndMinutes,
  editCutEndSeconds,
  showAddManualCutDialog,
  onCloseEditCutDialog,
  onSaveEditedCut,
  onCloseAddManualCutDialog,
  onSaveManualCut,
}: CutTimestampDialogsProps) {
  return (
    <>
      {showCutEditDialog && editingCutId && (
        <TimestampDialog
          mode="edit"
          initialStartMinutes={editCutStartMinutes}
          initialStartSeconds={editCutStartSeconds}
          initialEndMinutes={editCutEndMinutes}
          initialEndSeconds={editCutEndSeconds}
          onClose={onCloseEditCutDialog}
          onSave={onSaveEditedCut}
        />
      )}

      {showAddManualCutDialog && (
        <TimestampDialog
          mode="add"
          onClose={onCloseAddManualCutDialog}
          onSave={onSaveManualCut}
        />
      )}
    </>
  );
}
