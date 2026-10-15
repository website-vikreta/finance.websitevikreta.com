/** Run: npx tsx lib/chatbot/__tests__/intent.ts */
import assert from "node:assert/strict";
import { isCancel, isCasualGreeting, isConfirm, isHelpRequest } from "../intent";

for (const m of ["hi", "hii", "Hiiii!", "heyyy", "hellooo", "namaste", "thanks!", "shukriya"]) assert.ok(isCasualGreeting(m), m);
for (const m of ["hi, paid 500 for rent", "hello change amount to 500", "ok"]) assert.ok(!isCasualGreeting(m), m);
for (const m of ["help", "What can you do?", "kya kar sakte ho"]) assert.ok(isHelpRequest(m), m);
for (const m of ["no", "Nope", "cancel karo", "rehne do", "nahi", "discard it"]) assert.ok(isCancel(m), m);
for (const m of ["no, make it 600", "not rent, internet", "cancelled order refund 500"]) assert.ok(!isCancel(m), m);
for (const m of ["yes", "Yes please", "haan", "save it", "confirm"]) assert.ok(isConfirm(m), m);
for (const m of ["ok", "yes but change date", "save 500"]) assert.ok(!isConfirm(m), m);
console.log("intent ok");
