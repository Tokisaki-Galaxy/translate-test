import * as React from "react";

import { cn } from "@/lib/utils";

function Sidebar({ className, ...props }: React.ComponentProps<"aside">) {
  return (
    <aside
      className={cn(
        "flex h-screen w-full max-w-80 flex-col border-r border-border bg-muted/30",
        className,
      )}
      {...props}
    />
  );
}

function SidebarHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div className={cn("border-b border-border p-4", className)} {...props} />
  );
}

function SidebarContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("min-h-0 flex-1 overflow-y-auto p-4", className)}
      {...props}
    />
  );
}

function SidebarFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("space-y-4 border-t border-border p-4", className)}
      {...props}
    />
  );
}

function SidebarInset({ className, ...props }: React.ComponentProps<"main">) {
  return <main className={cn("min-w-0 flex-1", className)} {...props} />;
}

export { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarInset };
