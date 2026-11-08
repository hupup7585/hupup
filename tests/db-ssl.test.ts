import { describe, expect, it } from "vitest";
import { explicitSslMode } from "@/lib/db";

/* Same security as before (pg already treated these as verify-full), without the warning on every cold start. */
describe("database SSL mode", () => {
  it("spells out verify-full for prefer/require/verify-ca and leaves everything else alone", () => {
    expect(explicitSslMode("postgres://u:p@h.example/db?sslmode=require")).toBe("postgres://u:p@h.example/db?sslmode=verify-full");
    expect(explicitSslMode("postgres://u:p@h.example/db?sslmode=require&channel_binding=require")).toBe("postgres://u:p@h.example/db?sslmode=verify-full&channel_binding=require");
    expect(explicitSslMode("postgres://u:p@h.example/db?channel_binding=require&sslmode=prefer")).toBe("postgres://u:p@h.example/db?channel_binding=require&sslmode=verify-full");
    expect(explicitSslMode("postgres://u:p@h.example/db?sslmode=verify-full")).toBe("postgres://u:p@h.example/db?sslmode=verify-full");
    expect(explicitSslMode("postgres://postgres@127.0.0.1:54329/postgres")).toBe("postgres://postgres@127.0.0.1:54329/postgres");
    expect(explicitSslMode("postgres://u:p@h/db?sslmode=disable")).toBe("postgres://u:p@h/db?sslmode=disable");
  });
});
