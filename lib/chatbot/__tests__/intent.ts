/** Run: npx tsx lib/chatbot/__tests__/intent.ts */
import assert from "node:assert/strict";
import { isCancel, isCasualGreeting, isConfirm, isHelpRequest, startIntent } from "../intent";

for (const m of ["hi", "hii", "Hiiii!", "heyyy", "hellooo", "namaste", "thanks!", "shukriya"]) assert.ok(isCasualGreeting(m), m);
for (const m of ["hi, paid 500 for rent", "hello change amount to 500", "ok"]) assert.ok(!isCasualGreeting(m), m);
for (const m of ["help", "What can you do?", "kya kar sakte ho"]) assert.ok(isHelpRequest(m), m);
for (const m of ["no", "Nope", "cancel karo", "rehne do", "nahi", "discard it"]) assert.ok(isCancel(m), m);
for (const m of ["no, make it 600", "not rent, internet", "cancelled order refund 500"]) assert.ok(!isCancel(m), m);
for (const m of ["yes", "Yes please", "haan", "save it", "confirm"]) assert.ok(isConfirm(m), m);
for (const m of ["ok", "yes but change date", "save 500"]) assert.ok(!isConfirm(m), m);
for (const m of ["I want to add an expense", "add expense", "New expense", "expense add karna hai", "I'd like to record an expense"]) assert.equal(startIntent(m), "expense", m);
for (const m of ["I want to add an income", "add income", "income add karo", "naya income"]) assert.equal(startIntent(m), "income", m);
for (const m of ["add expense of 500 for chai", "paid 500 for chai", "expense", "how much expense this month"]) assert.equal(startIntent(m), null, m);
console.log("intent ok");
