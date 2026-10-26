ALTER TABLE "bank_statement_lines" DROP CONSTRAINT "chk_bank_statement_lines_amounts";--> statement-breakpoint
ALTER TABLE "bank_statement_lines" DROP CONSTRAINT "chk_bank_statement_lines_ready";--> statement-breakpoint
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "chk_bank_statement_lines_amounts" CHECK (("bank_statement_lines"."withdrawal_amount" IS NULL OR "bank_statement_lines"."withdrawal_amount" > 0 OR (
          "bank_statement_lines"."status" = 'pending' AND (
            ("bank_statement_lines"."withdrawal_amount" < 0 AND "bank_statement_lines"."flags" @> '["NEGATIVE_AMOUNT"]'::jsonb)
            OR ("bank_statement_lines"."withdrawal_amount" = 0 AND "bank_statement_lines"."flags" @> '["ZERO_AMOUNT"]'::jsonb)
          )
        ))
        AND ("bank_statement_lines"."deposit_amount" IS NULL OR "bank_statement_lines"."deposit_amount" > 0 OR (
          "bank_statement_lines"."status" = 'pending' AND (
            ("bank_statement_lines"."deposit_amount" < 0 AND "bank_statement_lines"."flags" @> '["NEGATIVE_AMOUNT"]'::jsonb)
            OR ("bank_statement_lines"."deposit_amount" = 0 AND "bank_statement_lines"."flags" @> '["ZERO_AMOUNT"]'::jsonb)
          )
        )));--> statement-breakpoint
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "chk_bank_statement_lines_ready" CHECK ("bank_statement_lines"."status" <> 'ready'
        OR (
          "bank_statement_lines"."txn_date" IS NOT NULL
          AND "bank_statement_lines"."narration" IS NOT NULL
          AND trim("bank_statement_lines"."narration") <> ''
          AND ("bank_statement_lines"."withdrawal_amount" IS NOT NULL) <> ("bank_statement_lines"."deposit_amount" IS NOT NULL)
          AND ("bank_statement_lines"."withdrawal_amount" IS NULL OR "bank_statement_lines"."withdrawal_amount" > 0)
          AND ("bank_statement_lines"."deposit_amount" IS NULL OR "bank_statement_lines"."deposit_amount" > 0)
        ));