"use client";

import { useActionState } from "react";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { addMemberAction, type AddMemberResult } from "./actions";

const ROLES = [
  { value: "manager", label: "Manager" },
  { value: "admin", label: "Admin" },
];

export function AddMemberForm() {
  const [state, action, isPending] = useActionState<AddMemberResult, FormData>(addMemberAction, { ok: false });

  return (
    <form action={action} noValidate className="mt-4 flex flex-col gap-3 @xl:flex-row @xl:flex-wrap @xl:items-end">
      <div className="flex flex-1 flex-col gap-2">
        <Label htmlFor="member-email">Email</Label>
        <Input id="member-email" name="email" type="email" autoComplete="off" placeholder="name@websitevikreta.com" disabled={isPending} aria-invalid={Boolean(state.error)} required />
      </div>
      <div className="flex flex-1 flex-col gap-2">
        <Label htmlFor="member-password">Password</Label>
        <Input id="member-password" name="password" type="password" autoComplete="new-password" minLength={8} disabled={isPending} aria-invalid={Boolean(state.error)} required />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="member-role">Role</Label>
        <Select name="role" items={ROLES} defaultValue="manager" disabled={isPending}>
          <SelectTrigger id="member-role" className="w-full @xl:w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ROLES.map((r) => (
              <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button type="submit" disabled={isPending}>
        <UserPlus aria-hidden />
        {isPending ? "Adding..." : "Add member"}
      </Button>
      {state.error ? (
        <p role="alert" className="text-caption text-destructive @xl:basis-full">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
