"use client";

import { useState, useTransition } from "react";
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
  const [state, setState] = useState<AddMemberResult>({ ok: false });
  const [isPending, startTransition] = useTransition();

  // A plain submit handler, not a form action: React resets action forms even when the server
  // rejects the input, which would wipe what was typed. Only a successful add clears the fields.
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    startTransition(async () => {
      const result = await addMemberAction(state, new FormData(form));
      setState(result);
      if (result.ok) form.reset();
    });
  }

  return (
    <form onSubmit={submit} noValidate className="mt-4 flex flex-col gap-3 @xl:flex-row @xl:flex-wrap @xl:items-end">
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
