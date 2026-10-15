import assert from "node:assert/strict";
import { cn } from "../utils";
assert.equal(cn("text-caption text-muted-foreground", "text-background"), "text-caption text-background");
assert.equal(cn("text-caption", "text-body-sm"), "text-body-sm");
console.log("cn ok");
