import { useRef, useState } from "react";
import { Button } from "./Button";
import { Card } from "./Card";
import { EmptyState } from "./EmptyState";
import { InlineMessage } from "./InlineMessage";
import { Modal } from "./Modal";
import { Skeleton } from "./Skeleton";
import { TextField } from "./TextField";

export function ComponentShowcase() {
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [dismissed, setDismissed] = useState(false);
  const submitButtonRef = useRef<HTMLButtonElement>(null);

  const hasEmailError = email.length > 0 && !email.includes("@");

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      <Card
        title="Reusable UI Components"
        description="Production-ready primitives with accessibility, edge-case handling and responsive behavior."
        actions={
          <Button variant="ghost" size="sm" onClick={() => setDialogOpen(true)}>
            Open dialog
          </Button>
        }
      >
        <div style={{ display: "grid", gap: "0.75rem" }}>
          <TextField
            label="Email"
            placeholder="you@company.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            error={hasEmailError ? "Please provide a valid email address." : undefined}
            hint="Used for account notifications"
            maxLength={120}
            showCounter
            required
          />

          {!dismissed ? (
            <InlineMessage
              tone="info"
              title="Edge-case ready"
              onDismiss={() => setDismissed(true)}
              action={<Button size="sm">Action</Button>}
            >
              Components expose graceful empty, loading and error states.
            </InlineMessage>
          ) : null}

          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
            <Button onClick={() => setLoading((current) => !current)} loading={loading}>
              Toggle loading
            </Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Danger</Button>
          </div>
        </div>
      </Card>

      <Card title="Loading Skeletons" compact>
        <Skeleton lines={3} height={12} />
      </Card>

      <EmptyState
        icon="◌"
        title="No data available"
        description="This state is keyboard-friendly and can include a primary action."
        action={<Button size="sm">Reload</Button>}
      />

      <Modal
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title="Accessible modal"
        description="Focus is trapped, ESC closes, and the initial action receives focus."
        initialFocusRef={submitButtonRef}
        footer={
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
            <Button variant="secondary" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button ref={submitButtonRef} onClick={() => setDialogOpen(false)}>
              Confirm
            </Button>
          </div>
        }
      >
        <p style={{ margin: 0 }}>Modal body with responsive layout and keyboard accessibility.</p>
      </Modal>
    </div>
  );
}
