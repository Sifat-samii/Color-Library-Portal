# Color Library

The Color Library is a shared approval workspace where a client company and Pixofix collaborate on color requests, reference versions, and an approved production library.

## Access

**Client Company**:
An organization whose representatives share one color library and one request history.
_Avoid_: Client user, account

**Representative**:
A named person who acts for a Client Company and signs in with a Google-authenticated email address.
_Avoid_: Client, portal user

**Authorized Representative**:
A Representative whose email address has been approved by an Administrator for a specific Client Company.
_Avoid_: Whitelisted user, approved Gmail

**Access Request**:
A request from an existing Representative asking an Administrator to authorize another Representative for the same Client Company.
_Avoid_: Invitation, signup request

**Administrator**:
A Pixofix operator who registers Client Companies, authorizes Representatives, uploads reference versions, and manages the approval workflow.

## Colors and references

**Explore Swatch**:
A reusable color in the shared Explore catalog that can seed a new Color Request but is not itself part of a Client Library.
_Avoid_: Approved color, library color

**Color Request**:
A client-scoped request for Pixofix to prepare one or more reference versions for a required hex color.
_Avoid_: Color, order

**Request Swatch**:
The visual color sample(s) on a Color Request. A system-generated Adobe RGB swatch from the hex is always stored; a Representative may also upload their own images.
_Avoid_: Reference

**Reference Version**:
An immutable image uploaded by an Administrator for client review within a Color Request.
_Avoid_: Swatch, delivery

**Needs Changes**:
The review outcome that returns the current reference version to the Administrator with required feedback.
_Avoid_: Rejected, failed

**Approval**:
The client review outcome that accepts the current reference version and identifies the Representative who approved it.

**Approved Color**:
A color published to a Client Library after approval, including its hex value, color name, and active approved reference versions.
_Avoid_: Explore Swatch, request

**Client Library**:
The Client Company's collection of Approved Colors and their approved reference history.
_Avoid_: Explore catalog

## Collaboration

**Activity Event**:
An immutable, actor-attributed record of a meaningful action in a Color Request or access workflow.
_Avoid_: Log entry, audit row

**Comment**:
A message attributed to a Representative or Administrator and attached to a Color Request. It may optionally name a Reference Version or Request Swatch image, and may optionally mark a point on that preview (`pin_x` / `pin_y` as a percentage of the image). Unpinned comments remain valid.

**Notification**:
A per-recipient alert derived from an Activity Event, with unread/read state and a link to the affected record.
_Avoid_: Activity Event
