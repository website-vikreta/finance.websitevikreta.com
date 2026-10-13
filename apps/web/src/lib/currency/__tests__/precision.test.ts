import {
  parseExactDecimalToBigInt,
  divideHalfEven,
  convertUsdToInrPaise,
  inrToPaise,
  formatScaledBigIntToDecimal,
  toMajorDecimal,
  convertUsdToInrDecimal,
  DecimalPrecisionError,
} from "../precision";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertThrows(fn: () => unknown, expectedSubstring: string, testName: string) {
  try {
    fn();
    throw new Error(`Expected error containing "${expectedSubstring}", but no error was thrown in: ${testName}`);
  } catch (err: unknown) {
    if (err instanceof DecimalPrecisionError) {
      assert(
        err.message.includes(expectedSubstring),
        `${testName}: error message "${err.message}" did not contain "${expectedSubstring}"`,
      );
    } else if (err instanceof Error && err.message.startsWith("Expected error")) {
      throw err;
    } else {
      throw new Error(`${testName}: unexpected error type: ${String(err)}`);
    }
  }
}

let passed = 0;
function runTest(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}`);
    throw e;
  }
}

console.log("Running Precision & Banker's Rounding (Half-Even) Unit Tests...\n");

// 1. Parsing & Precision Limits
runTest("parseExactDecimalToBigInt: scales whole integers", () => {
  assert(parseExactDecimalToBigInt("100", 2) === BigInt(10000), "100 scale 2 should be 10000");
  assert(parseExactDecimalToBigInt("88", 4) === BigInt(880000), "88 scale 4 should be 880000");
});

runTest("parseExactDecimalToBigInt: scales fractional numbers with exact padding", () => {
  assert(parseExactDecimalToBigInt("100.5", 2) === BigInt(10050), "100.5 scale 2 should be 10050");
  assert(parseExactDecimalToBigInt("100.25", 2) === BigInt(10025), "100.25 scale 2 should be 10025");
  assert(parseExactDecimalToBigInt("88.5", 4) === BigInt(885000), "88.5 scale 4 should be 885000");
  assert(parseExactDecimalToBigInt("88.525", 4) === BigInt(885250), "88.525 scale 4 should be 885250");
});

runTest("parseExactDecimalToBigInt: rejects excess precision without truncation", () => {
  assertThrows(
    () => parseExactDecimalToBigInt("100.255", 2),
    "Unsupported decimal precision",
    "excess currency decimals (3 decimals)",
  );
  assertThrows(
    () => parseExactDecimalToBigInt("88.12345", 4),
    "Unsupported decimal precision",
    "excess rate decimals (5 decimals)",
  );
});

runTest("parseExactDecimalToBigInt: rejects non-string inputs", () => {
  // @ts-expect-error testing invalid type
  assertThrows(() => parseExactDecimalToBigInt(100.25, 2), "Expected a decimal string", "number input guard");
});

runTest("parseExactDecimalToBigInt: rejects invalid string formats", () => {
  assertThrows(() => parseExactDecimalToBigInt("abc", 2), "Invalid numeric string", "letters");
  assertThrows(() => parseExactDecimalToBigInt("10.20.30", 2), "Invalid numeric string", "multiple dots");
  assertThrows(() => parseExactDecimalToBigInt("$500", 2), "Invalid numeric string", "currency symbols");
});

// 2. Banker's Rounding (Half-Even) Boundary Tests
runTest("divideHalfEven: rounds down when remainder < half", () => {
  assert(divideHalfEven(BigInt(24), BigInt(10)) === BigInt(2), "2.4 should round to 2");
  assert(divideHalfEven(BigInt(34), BigInt(10)) === BigInt(3), "3.4 should round to 3");
});

runTest("divideHalfEven: rounds up when remainder > half", () => {
  assert(divideHalfEven(BigInt(26), BigInt(10)) === BigInt(3), "2.6 should round to 3");
  assert(divideHalfEven(BigInt(36), BigInt(10)) === BigInt(4), "3.6 should round to 4");
});

runTest("divideHalfEven: tie-breaks to even (down when quotient is even)", () => {
  assert(divideHalfEven(BigInt(25), BigInt(10)) === BigInt(2), "2.5 should round to 2 (even)");
  assert(divideHalfEven(BigInt(88525000), BigInt(10000)) === BigInt(8852), "8852.5 should round to 8852 (even)");
});

runTest("divideHalfEven: tie-breaks to even (up when quotient is odd)", () => {
  assert(divideHalfEven(BigInt(35), BigInt(10)) === BigInt(4), "3.5 should round to 4 (even)");
  assert(divideHalfEven(BigInt(88535000), BigInt(10000)) === BigInt(8854), "8853.5 should round to 8854 (even)");
});

// 3. USD to INR Conversion with Half-Even Rounding
runTest("convertUsdToInrPaise: standard calculation without fractional cents", () => {
  assert(convertUsdToInrPaise("500", "88.50") === BigInt(4425000), "500 * 88.50 should be 4425000 paise");
  assert(convertUsdToInrPaise("500.00", "88.5") === BigInt(4425000), "500.00 * 88.5 should be 4425000 paise");
});

runTest("convertUsdToInrPaise: Half-Even tie boundary cases", () => {
  assert(convertUsdToInrPaise("1.00", "88.5250") === BigInt(8852), "$1.00 @ 88.5250 should round to 8852 paise");
  assert(convertUsdToInrPaise("1.00", "88.5350") === BigInt(8854), "$1.00 @ 88.5350 should round to 8854 paise");
});

runTest("convertUsdToInrPaise: non-tie close fractions", () => {
  assert(convertUsdToInrPaise("1.00", "88.5251") === BigInt(8853), "$1.00 @ 88.5251 should round to 8853 paise");
  assert(convertUsdToInrPaise("1.00", "88.5249") === BigInt(8852), "$1.00 @ 88.5249 should round to 8852 paise");
});

runTest("convertUsdToInrPaise: rejects zero or negative amounts/rates", () => {
  assertThrows(() => convertUsdToInrPaise("0", "88.5"), "USD amount must be positive", "zero amount");
  assertThrows(() => convertUsdToInrPaise("-100", "88.5"), "USD amount must be positive", "negative amount");
  assertThrows(() => convertUsdToInrPaise("100", "0"), "Exchange rate must be positive", "zero rate");
  assertThrows(() => convertUsdToInrPaise("100", "-88.5"), "Exchange rate must be positive", "negative rate");
});

// 4. INR to Paise Conversion
runTest("inrToPaise: converts valid rupee string to paise", () => {
  assert(inrToPaise("500") === BigInt(50000), "500 INR should be 50000 paise");
  assert(inrToPaise("1250.75") === BigInt(125075), "1250.75 INR should be 125075 paise");
});

runTest("inrToPaise: rejects negative or zero rupee amounts", () => {
  assertThrows(() => inrToPaise("0"), "INR amount must be positive", "zero INR");
  assertThrows(() => inrToPaise("-50"), "INR amount must be positive", "negative INR");
  assertThrows(() => inrToPaise("500.123"), "Unsupported decimal precision", "excess INR decimals");
});

// 5. Major-Unit Decimal Representation (NUMERIC 18,2)
runTest("formatScaledBigIntToDecimal: formats scaled BigInt to exact fixed decimal string", () => {
  assert(formatScaledBigIntToDecimal(BigInt(50000), 2) === "500.00", "50000 scale 2 should format to 500.00");
  assert(formatScaledBigIntToDecimal(BigInt(4000), 2) === "40.00", "4000 scale 2 should format to 40.00");
  assert(formatScaledBigIntToDecimal(BigInt(40000), 2) === "400.00", "40000 scale 2 should format to 400.00");
  assert(formatScaledBigIntToDecimal(BigInt(50025), 2) === "500.25", "50025 scale 2 should format to 500.25");
  assert(formatScaledBigIntToDecimal(BigInt(4425000), 2) === "44250.00", "4425000 scale 2 should format to 44250.00");
});

runTest("toMajorDecimal: formats integer and decimal inputs to exact 2-decimal strings", () => {
  assert(toMajorDecimal("500") === "500.00", "500 should format to 500.00");
  assert(toMajorDecimal("40") === "40.00", "40 should format to 40.00");
  assert(toMajorDecimal("400") === "400.00", "400 should format to 400.00");
  assert(toMajorDecimal("500.25") === "500.25", "500.25 should remain exact 500.25");
  assert(toMajorDecimal("500.2") === "500.20", "500.2 should pad to 500.20");
});

runTest("toMajorDecimal: rejects invalid precision and non-positive values", () => {
  assertThrows(() => toMajorDecimal("500.125"), "Unsupported decimal precision", "excess decimals");
  assertThrows(() => toMajorDecimal("0"), "Amount must be positive", "zero amount");
  assertThrows(() => toMajorDecimal("-40"), "Amount must be positive", "negative amount");
});

runTest("convertUsdToInrDecimal: calculates USD to exact INR major-unit string with Banker's Rounding", () => {
  assert(convertUsdToInrDecimal("500", "88.50") === "44250.00", "$500 @ 88.50 should be 44250.00");
  assert(convertUsdToInrDecimal("500.00", "88.5") === "44250.00", "$500.00 @ 88.5 should be 44250.00");
  assert(convertUsdToInrDecimal("1.00", "88.5250") === "88.52", "Half-even tie to even should be 88.52");
  assert(convertUsdToInrDecimal("1.00", "88.5350") === "88.54", "Half-even tie to odd should be 88.54");
});

console.log(`\nAll ${passed} precision tests passed successfully!`);
