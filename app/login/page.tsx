"use client";

import Image from "next/image";
import { useActionState, useState } from "react";
import { Eye, EyeOff, LogIn } from "lucide-react";
import { loginAction, type LoginResult } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: LoginResult = { ok: false, error: "" };

export default function LoginPage() {
  const [state, action, isPending] = useActionState(loginAction, initialState);
  const [showPassword, setShowPassword] = useState(false);
  const errorMessage = !state.ok && state.error ? state.error : null;

  return (
    <main className="min-h-dvh bg-background lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(420px,0.9fr)]">
      <section className="flex min-h-dvh flex-col px-6 py-6 sm:px-10 lg:px-16 xl:px-24">
        <div className="flex items-center gap-3" aria-label="Website Vikreta Finance">
          <Image
            src="/brand/websitevikreta-logo-horizontal.svg"
            alt="Website Vikreta"
            width={1364}
            height={300}
            priority
            className="h-auto w-44"
          />
          <span className="h-5 w-px bg-border" aria-hidden />
          <span className="text-caption text-muted-foreground">Finance</span>
        </div>

        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-12">
          <h1 className="text-display-sm">Sign in</h1>

          <form
            action={action}
            noValidate
            aria-describedby={errorMessage ? "login-error" : undefined}
            className="mt-10 flex flex-col gap-5"
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Work email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                inputMode="email"
                placeholder="you@websitevikreta.com"
                aria-invalid={Boolean(errorMessage)}
                disabled={isPending}
                required
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  className="pr-12"
                  aria-invalid={Boolean(errorMessage)}
                  disabled={isPending}
                  required
                />
                <button
                  type="button"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((visible) => !visible)}
                  disabled={isPending}
                  className="absolute right-1 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
                >
                  {showPassword ? (
                    <EyeOff className="size-4" aria-hidden />
                  ) : (
                    <Eye className="size-4" aria-hidden />
                  )}
                </button>
              </div>
            </div>

            {errorMessage ? (
              <p id="login-error" role="alert" className="text-caption text-destructive">
                {errorMessage}
              </p>
            ) : (
              <p className="text-caption text-muted-foreground">
                Use your Website Vikreta account.
              </p>
            )}

            <Button
              type="submit"
              disabled={isPending}
              className="mt-1 w-full"
              size="lg"
            >
              <LogIn className="size-4" aria-hidden />
              {isPending ? "Signing in..." : "Sign in"}
            </Button>
          </form>
        </div>

        <p className="text-caption text-muted-foreground">Team access only.</p>
      </section>

      <aside className="hidden p-4 lg:block">
        <div className="relative flex min-h-[calc(100dvh-2rem)] rounded-xl bg-primary p-10 text-primary-foreground xl:p-12">
          <h2 className="text-display-md xl:text-display-lg">Website Vikreta Finance</h2>
        </div>
      </aside>
    </main>
  );
}
