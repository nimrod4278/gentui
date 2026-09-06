# Security policy

## Supported versions

Gentui is pre-1.0. Security fixes are applied to the latest revision on the default branch; older revisions are not supported.

## Reporting a vulnerability

Please do **not** open a public issue for a suspected vulnerability. Use GitHub's **Report a vulnerability** flow in the repository's Security tab to submit a private advisory. Include affected versions, impact, reproduction steps, and any suggested mitigation. Remove credentials and personal data from reports.

If private vulnerability reporting is unavailable, contact a maintainer privately through the contact method on their GitHub profile before sharing details.

You can expect an acknowledgement within seven days. Maintainers will coordinate validation, remediation, disclosure, and credit with the reporter.

## Security boundaries

Generated documents and interaction payloads are untrusted data. Gentui does not grant them shell, filesystem, network, model-provider, credential, or durable-storage access. Hosts remain responsible for authorization and for protecting data before placing it in a document. See [the security and trust model](spec/06-security.md).
