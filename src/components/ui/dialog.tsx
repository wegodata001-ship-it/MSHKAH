import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Single z-index hierarchy for overlays:
 * content/sidebar 0–50 · dropdown 100 · popover 200 ·
 * fullscreen surfaces (kitchen) 900 ·
 * modal overlay 1000 · modal positioner/content 1010 · nested select 1020 · toast 1100
 */
export const DIALOG_Z = {
  overlay: "z-[1000]",
  content: "z-[1010]",
  nested: "z-[1020]",
  toast: "z-[1100]",
  fullscreen: "z-[900]",
} as const;

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

/** Dimmer only — never a flex centering container, never nests Content. */
const DialogOverlay = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 bg-black/[0.38] backdrop-blur-[2px]",
      DIALOG_Z.overlay,
      className
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

/**
 * Viewport positioner — sibling of Overlay (NOT a child).
 * Centers Content; overflow scrolls the shell if needed.
 * pointer-events:none so clicks on empty space hit the Overlay and dismiss.
 */
function DialogPositioner({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      data-slot="dialog-positioner"
      className={cn(
        // Sibling of Overlay — centers Content in the VIEWPORT.
        // Content must keep max-h ≤ viewport so items-center cannot push top < 0.
        "fixed inset-0 flex items-center justify-center overflow-y-auto",
        "p-3 sm:p-6",
        "pointer-events-none",
        DIALOG_Z.content,
        className
      )}
    >
      {children}
    </div>
  );
}

type DialogContentProps = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  overlayClassName?: string;
  /**
   * center — Overlay (dimmer) + Positioner (flex center) as siblings
   * custom — consumer owns all positioning (side panels / bottom sheets)
   */
  layout?: "center" | "custom";
  /** Skip the default Dialog close control when the consumer renders its own. */
  hideCloseButton?: boolean;
};

const DialogContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(({ className, overlayClassName, layout = "center", hideCloseButton = false, children, style, ...props }, ref) => {
  const closeButton = hideCloseButton ? null : (
    <DialogPrimitive.Close className="absolute end-4 top-4 z-10 rounded-lg p-1 text-coffee/60 transition-colors hover:bg-beige/60 hover:text-dark-brown focus:outline-none">
      <X className="h-4 w-4" />
      <span className="sr-only">Close</span>
    </DialogPrimitive.Close>
  );

  if (layout === "custom") {
    return (
      <DialogPortal>
        <DialogOverlay className={overlayClassName} />
        <DialogPrimitive.Content
          ref={ref}
          className={cn("fixed outline-none", DIALOG_Z.content, className)}
          style={{ opacity: 1, ...style }}
          {...props}
        >
          {children}
          {closeButton}
        </DialogPrimitive.Content>
      </DialogPortal>
    );
  }

  // ROOT FIX: Overlay and Content are SIBLINGS.
  // Overlay = dimmer only. Positioner = viewport centering.
  return (
    <DialogPortal>
      <DialogOverlay className={overlayClassName} />
      <DialogPositioner>
        <DialogPrimitive.Content
          ref={ref}
          className={cn(
            "pointer-events-auto relative flex w-full max-w-md shrink-0 flex-col gap-4",
            "max-h-[calc(100dvh-24px)] sm:max-h-[calc(100dvh-48px)]",
            "overflow-hidden rounded-[20px]",
            "border border-black/[0.06] p-6 text-dark-brown shadow-elevated outline-none",
            className
          )}
          style={{ backgroundColor: "#FFFFFF", opacity: 1, ...style }}
          {...props}
        >
          {children}
          {closeButton}
        </DialogPrimitive.Content>
      </DialogPositioner>
    </DialogPortal>
  );
});
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("flex flex-col space-y-2 text-center sm:text-left", className)}
    {...props}
  />
);

const DialogTitle = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-xl font-semibold text-dark-brown", className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-coffee/70", className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
};
