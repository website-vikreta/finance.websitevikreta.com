/**
 * Financial precision module.
 *
 * Implements exact integer arithmetic and Banker's Rounding (Half-Even)
 * using JavaScript BigInt. Never uses IEEE-754 floating-point operations
 * or toFixed() for financial calculations.
 *
 * Rounding Rule (data-safety.md):
 *   Half-Even (roundTiesToEven): when fractional remainder is exactly half,
 *   round to the nearest even integer.
 */

const ZERO = BigInt(0);
const ONE = BigInt(1);
const TWO = BigInt(2);
const TEN = BigInt(10);
const NEG_ONE = BigInt(-1);
const TEN_THOUSAND = BigInt(10000);

export class DecimalPrecisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecimalPrecisionError";
  }
}

/**
 * Validates a decimal string and converts it to a scaled BigInt.
 * Rejects unsupported precision (more decimal places than maxFractionDigits)
 * instead of silently truncating.
 *
 * @param input - The validated decimal string (e.g. "100.25", "88.5000", "500").
 * @param maxFractionDigits - Maximum allowed decimal places (2 for currency, 4 for rates).
 * @returns The scaled BigInt value.
 * @throws DecimalPrecisionError on invalid format or excess decimal places.
 */
export function parseExactDecimalToBigInt(
  input: string,
  maxFractionDigits: number,
): bigint {
  if (typeof input !== "string") {
    throw new DecimalPrecisionError(
      `Expected a decimal string, received ${typeof input}. Do not pass raw floating-point numbers.`,
    );
  }

  const trimmed = input.trim();

  // Pattern: optional negative sign, digits, optional decimal point followed by digits
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    throw new DecimalPrecisionError(`Invalid numeric string format: "${trimmed}"`);
  }

  const [intPart, fracPart = ""] = trimmed.split(".");

  if (fracPart.length > maxFractionDigits) {
    throw new DecimalPrecisionError(
      `Unsupported decimal precision: "${trimmed}" has ${fracPart.length} decimal places (maximum allowed is ${maxFractionDigits}).`,
    );
  }

  const sign = intPart.startsWith("-") ? NEG_ONE : ONE;
  const absInt = intPart.replace("-", "");
  const paddedFrac = fracPart.padEnd(maxFractionDigits, "0");

  return sign * (BigInt(absInt) * (TEN ** BigInt(maxFractionDigits)) + BigInt(paddedFrac));
}

/**
 * Exact integer division with Banker's Rounding (Half-Even).
 * Divides numerator by denominator. When remainder * 2 === denominator (an exact tie),
 * rounds to the nearest EVEN quotient.
 *
 * @param numerator - BigInt dividend.
 * @param denominator - Positive BigInt divisor.
 * @returns Rounded BigInt quotient.
 */
export function divideHalfEven(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= ZERO) {
    throw new DecimalPrecisionError("Denominator must be a positive integer.");
  }

  const sign = numerator < ZERO ? NEG_ONE : ONE;
  const absNum = numerator < ZERO ? -numerator : numerator;

  const quotient = absNum / denominator;
  const remainder = absNum % denominator;
  const remainder2 = remainder * TWO;

  if (remainder2 < denominator) {
    // Less than half: round down towards zero
    return sign * quotient;
  } else if (remainder2 > denominator) {
    // Greater than half: round up away from zero
    return sign * (quotient + ONE);
  } else {
    // Exactly half: tie-break to even quotient
    const isEven = quotient % TWO === ZERO;
    return sign * (isEven ? quotient : quotient + ONE);
  }
}

/**
 * Converts a validated USD amount string and exchange rate string into INR paise (minor units).
 *
 * USD amount: max 2 decimal places (dollars & cents). Scale = 2.
 * Exchange rate: max 4 decimal places. Scale = 4.
 *
 * Product scale = 2 + 4 = 6.
 * Target scale = 2 (INR paise).
 * Divisor = 10^(6 - 2) = 10^4 = 10,000.
 *
 * @param originalAmountUsd - Validated USD string (e.g. "100.25").
 * @param exchangeRate - Validated exchange rate string (e.g. "88.5250").
 * @returns Exact INR paise as BigInt.
 */
export function convertUsdToInrPaise(
  originalAmountUsd: string,
  exchangeRate: string,
): bigint {
  const cents = parseExactDecimalToBigInt(originalAmountUsd, 2);
  const rateScaled = parseExactDecimalToBigInt(exchangeRate, 4);

  if (cents <= ZERO) {
    throw new DecimalPrecisionError("USD amount must be positive.");
  }
  if (rateScaled <= ZERO) {
    throw new DecimalPrecisionError("Exchange rate must be positive.");
  }

  const product = cents * rateScaled;
  return divideHalfEven(product, TEN_THOUSAND);
}

/**
 * Converts a validated INR amount string into paise (minor units).
 *
 * INR amount: max 2 decimal places (rupees & paise). Scale = 2.
 *
 * @param originalAmountInr - Validated INR string (e.g. "500.00", "1250").
 * @returns Exact INR paise as BigInt.
 */
export function inrToPaise(originalAmountInr: string): bigint {
  const paise = parseExactDecimalToBigInt(originalAmountInr, 2);
  if (paise <= ZERO) {
    throw new DecimalPrecisionError("INR amount must be positive.");
  }
  return paise;
}

/**
 * Formats a scaled BigInt back to an exact fixed-point decimal string.
 *
 * @param scaled - Scaled BigInt value (e.g. 50000n for 500.00).
 * @param fractionDigits - Scale digits (defaults to 2).
 * @returns Exact decimal string formatted to fractionDigits (e.g. "500.00").
 */
export function formatScaledBigIntToDecimal(
  scaled: bigint,
  fractionDigits: number = 2,
): string {
  const sign = scaled < ZERO ? "-" : "";
  const abs = scaled < ZERO ? -scaled : scaled;
  const divisor = TEN ** BigInt(fractionDigits);
  const intPart = abs / divisor;
  const fracPart = abs % divisor;
  const fracStr = fracPart.toString().padStart(fractionDigits, "0");
  return `${sign}${intPart.toString()}.${fracStr}`;
}

/**
 * Validates and converts an amount string into an exact major-unit decimal string (NUMERIC(18,2)).
 * Rejects numbers with > 2 decimal places or non-positive values.
 *
 * @param input - Decimal string (e.g. "500", "40", "500.25").
 * @returns Exact two-decimal string (e.g. "500.00", "40.00", "500.25").
 */
export function toMajorDecimal(input: string): string {
  const scaled = parseExactDecimalToBigInt(input, 2);
  if (scaled <= ZERO) {
    throw new DecimalPrecisionError("Amount must be positive.");
  }
  return formatScaledBigIntToDecimal(scaled, 2);
}

/**
 * Converts a validated USD amount string and exchange rate string into an exact INR
 * major-unit decimal string (NUMERIC(18,2)) using Banker's Rounding (Half-Even).
 *
 * @param originalAmountUsd - Validated USD string (e.g. "500", "500.00").
 * @param exchangeRate - Validated exchange rate string (e.g. "88.50", "88.5250").
 * @returns Exact INR decimal string (e.g. "44250.00").
 */
export function convertUsdToInrDecimal(
  originalAmountUsd: string,
  exchangeRate: string,
): string {
  const paise = convertUsdToInrPaise(originalAmountUsd, exchangeRate);
  return formatScaledBigIntToDecimal(paise, 2);
}

