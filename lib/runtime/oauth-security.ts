import type { OpenApiEndpoint } from "../types";

function securityRecords(security: unknown): Array<Record<string, unknown>> {
  if (!security) return [];
  if (Array.isArray(security)) {
    return security.filter((item): item is Record<string, unknown> =>
      Boolean(item && typeof item === "object" && !Array.isArray(item))
    );
  }
  return security && typeof security === "object" && !Array.isArray(security)
    ? [security as Record<string, unknown>]
    : [];
}

function isOAuthSecurityEntry(endpoint: OpenApiEndpoint, name: string, value: unknown) {
  if (endpoint.oauth_security_schemes?.includes(name)) return true;
  return /oauth|openid|oidc/i.test(name)
    || (Array.isArray(value) && value.some((scope) =>
      typeof scope === "string" && /oauth|openid|profile|email|offline_access/i.test(scope)
    ));
}

function normalizedScopes(scopes: unknown) {
  if (!Array.isArray(scopes)) return [];
  return Array.from(new Set(scopes
    .filter((scope): scope is string => typeof scope === "string")
    .map((scope) => scope.trim())
    .filter(Boolean)));
}

export function oauthSecuritySchemeNames(endpoint: OpenApiEndpoint) {
  const security = endpoint.security_requirements ?? endpoint.security;
  return Array.from(new Set(securityRecords(security).flatMap((record) =>
    Object.entries(record)
      .filter(([name, value]) => isOAuthSecurityEntry(endpoint, name, value))
      .map(([name]) => name)
  )));
}

export function hasOAuthSecurityRequirement(endpoint: OpenApiEndpoint) {
  return oauthSecuritySchemeNames(endpoint).length > 0;
}

export function hasIncompleteSecuritySchemeMetadata(endpoint: OpenApiEndpoint) {
  const security = endpoint.security_requirements ?? endpoint.security;
  return securityRecords(security).length > 0 && endpoint.security_scheme_metadata_complete !== true;
}

export function hasAmbiguousScopedSecurityRequirement(endpoint: OpenApiEndpoint) {
  if (hasOAuthSecurityRequirement(endpoint)) return false;
  const security = endpoint.security_requirements ?? endpoint.security;
  return hasIncompleteSecuritySchemeMetadata(endpoint) && securityRecords(security).some((record) =>
    Object.values(record).some((value) => !Array.isArray(value) || value.some((scope) => typeof scope !== "string" || scope.trim().length > 0))
  );
}

export function oauthSecurityMetadata(endpoint: OpenApiEndpoint, securityScheme: string) {
  return endpoint.oauth_security_metadata?.[securityScheme] ?? null;
}

export function oauthSecurityBinding(endpoint: OpenApiEndpoint, securityScheme: string) {
  return endpoint.oauth_security_bindings?.[securityScheme] ?? null;
}

function oauthScopeAlternatives(endpoint: OpenApiEndpoint) {
  const security = endpoint.security_requirements ?? endpoint.security;
  return securityRecords(security).flatMap((record) => {
    const oauthEntries = Object.entries(record).filter(([name, value]) => isOAuthSecurityEntry(endpoint, name, value));
    if (oauthEntries.length === 0) return [];
    return [{
      securitySchemes: oauthEntries.map(([name]) => name),
      valid: oauthEntries.every(([, value]) => Array.isArray(value) && value.every((scope) => typeof scope === "string")),
      requiredScopes: normalizedScopes(oauthEntries.flatMap(([, value]) => Array.isArray(value) ? value : [])),
    }];
  });
}

export function evaluateOAuthScopeGrant(endpoint: OpenApiEndpoint, grantedScopes: unknown, securityScheme?: string | null) {
  const allAlternatives = oauthScopeAlternatives(endpoint);
  const alternatives = securityScheme
    ? allAlternatives.filter((alternative) =>
        alternative.securitySchemes.length === 1 && alternative.securitySchemes[0] === securityScheme
      )
    : allAlternatives;
  const validAlternatives = alternatives.filter((alternative) => alternative.valid);
  const granted = new Set(normalizedScopes(grantedScopes));

  if (allAlternatives.length === 0) {
    return { allowed: true, requiredScopes: [] as string[], missingScopes: [] as string[] };
  }
  if (validAlternatives.length === 0) {
    return { allowed: false, requiredScopes: [] as string[], missingScopes: [] as string[] };
  }
  if (validAlternatives.some((alternative) => alternative.requiredScopes.length === 0)) {
    return { allowed: true, requiredScopes: [] as string[], missingScopes: [] as string[] };
  }

  const candidates = validAlternatives.map(({ requiredScopes }) => ({
    requiredScopes,
    missingScopes: requiredScopes.filter((scope) => !granted.has(scope)),
  })).sort((left, right) => left.missingScopes.length - right.missingScopes.length);
  const closest = candidates[0];

  return {
    allowed: closest.missingScopes.length === 0,
    requiredScopes: closest.requiredScopes,
    missingScopes: closest.missingScopes,
  };
}
