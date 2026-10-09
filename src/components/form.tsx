"use client";

import { useFormStatus } from "react-dom";
import { Button } from "./ui";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import type { ReactNode, ComponentProps } from "react";

/** Submit button with pending spinner, for use inside <form action={...}>. */
export function SubmitButton({
  children,
  className,
  variant = "primary",
  size,
  ...rest
}: {
  children: ReactNode;
  className?: string;
  variant?: ComponentProps<typeof Button>["variant"];
  size?: "sm";
} & Omit<ComponentProps<typeof Button>, "variant" | "size">) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} size={size} disabled={pending} className={cn(className)} {...rest}>
      {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </Button>
  );
}

/** Confirm-on-click submit button for destructive actions. */
export function ConfirmSubmit({
  children,
  confirm,
  className,
  variant = "danger",
  size,
}: {
  children: ReactNode;
  confirm: string;
  className?: string;
  variant?: ComponentProps<typeof Button>["variant"];
  size?: "sm";
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant={variant}
      size={size}
      disabled={pending}
      className={className}
      onClick={(e) => {
        if (!window.confirm(confirm)) e.preventDefault();
      }}
    >
      {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </Button>
  );
}
