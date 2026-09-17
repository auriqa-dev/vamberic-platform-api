import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JWTPayload,
} from "jose";

export const authEnvironment = {
  AWS_REGION: "eu-west-2",
  COGNITO_USER_POOL_ID: "eu-west-2_TestPool",
  COGNITO_CLIENT_ID: "testclient",
};
export const testIssuer =
  "https://cognito-idp.eu-west-2.amazonaws.com/eu-west-2_TestPool";

export async function createTestAuth() {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = {
    ...(await exportJWK(publicKey)),
    kid: "test-key",
    alg: "RS256",
    use: "sig",
  };
  const keyResolver = createLocalJWKSet({ keys: [jwk] });
  const sign = (claims: JWTPayload = {}) =>
    new SignJWT({
      iss: testIssuer,
      sub: "test-user-subject",
      client_id: authEnvironment.COGNITO_CLIENT_ID,
      token_use: "access",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 300,
      ...claims,
    })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .sign(privateKey);
  return { keyResolver, sign };
}
