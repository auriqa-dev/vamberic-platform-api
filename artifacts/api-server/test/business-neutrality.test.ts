import assert from "node:assert/strict";
import { test } from "node:test";
import {
  countryCode,
  registrationIdentity,
  registrationReference,
  readRegistration,
} from "../src/services/icp/registration";
import { CompanyProfileSchema } from "../src/services/psu/company";
test("foreign and unspecified registrations retain punctuation and never acquire UK identity", () => {
  for (const [country, type, value] of [
    ["US", "tax_id", "12-3456789"],
    ["Germany", "trade_register", "HRB 12345"],
    ["", "", "123"],
  ]) {
    const r = registrationIdentity(value, country, type);
    assert.equal(r.value, value);
    assert.ok(!registrationReference(r).startsWith("GB:"));
    assert.deepEqual(readRegistration(registrationReference(r)), r);
  }
  assert.equal(
    registrationReference(registrationIdentity("123", "GB", "company_number")),
    "GB:00000123",
  );
  assert.equal(registrationIdentity("123", "GB", "tax_id").value, "123");
  assert.equal(countryCode("Canada"), "CA");
  assert.equal(countryCode("Germany"), "DE");
  assert.deepEqual(readRegistration("GB:00000123"), {
    jurisdiction: "GB",
    type: "company_number",
    value: "00000123",
  });
});
test("manual company allows no website while supplied websites remain validated", () => {
  const company = {
    name: "Local service",
    brandName: "Local service",
    description: "Appointments by telephone",
  };
  assert.ok(CompanyProfileSchema.safeParse(company).success);
  assert.equal(
    CompanyProfileSchema.safeParse({
      ...company,
      websiteUrl: "https://user:password@example.com",
    }).success,
    false,
  );
});
