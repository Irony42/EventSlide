import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import request from 'supertest'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import * as requestSchemas from '../schemas/requestSchemas'
import { buildServerHarness } from '../testing/serverHarness'

/**
 * The other direction of the wire contract: what the client **sends**.
 *
 * `dtoContract.test.ts` next door compares the two declarations of every *response*.
 * This file compares the two declarations of every *request* — the bodies and query
 * strings `web/src/lib/api/client.ts` constructs, against the zod schemas
 * `schemas/requestSchemas.ts` parses them with.
 *
 * It exists because of a defect the ring mesh let through in full. `inviteModerator`
 * sent `{ email }`; `moderatorInvitationBody` is `.strict()` and requires
 * `temporaryPassword` as well. Every invitation a host sent came back
 * `400 request.invalid` — 100% of them. Both sides were tested, and both tests passed:
 * the ring-4 route test posted a complete body of its own, and the ring-5 component
 * test asserted that the panel calls `api.inviteModerator`. Neither could see the other
 * half, so nothing failed until a person typed an address into the real form.
 *
 * ## How the two halves are obtained
 *
 * Neither side is restated here. A test that spells out what it *believes* the client
 * sends carries the same duplication that caused the defect, and would have agreed with
 * the broken client just as happily.
 *
 * - **The server half is the real schema object**, imported and interrogated. It lives
 *   under `src/`, so importing it is ordinary.
 * - **The client half is read out of the client's own source text.** Importing it is
 *   not available: `eslint.config.js` forbids `src/interface` from importing `web/**`,
 *   and the two are separate tsconfig projects with different module resolution. So the
 *   file is parsed, the `transport.post(...)` / `transport.get(...)` calls in
 *   `createApi` are found, and the keys of the object each one passes are taken from the
 *   syntax tree. Reading a path is not an import: nothing here couples the server's
 *   build to the web app's, which is the same trade `dtoContract.test.ts` makes and for
 *   the same reason.
 * - **The pairing is derived, not declared.** `server.ts` says where each router is
 *   mounted and in what order; each router says which path and which schema each route
 *   uses. A client call is matched to a route the way Express would match it. So an
 *   endpoint added on either side without its counterpart shows up as an unmatched call
 *   rather than as silence.
 *
 * ## What it asserts, and what it cannot
 *
 * Only **shape**. The values a body carries are runtime data — an address typed by a
 * host, a caption typed by a guest — and no amount of source reading knows them. So:
 *
 * - Every key the client sends is a key the schema declares. On a `.strict()` body an
 *   undeclared key is `400 request.invalid` for the whole request, so this is the
 *   difference between a working feature and a dead one.
 * - Every key the schema requires is a key the client always sends. That is F4, exactly.
 * - A key the client sends only conditionally is matched against a key the schema
 *   treats as optional.
 *
 * It does **not** catch a value that is the wrong length, the wrong format, or the wrong
 * member of an enum — `z.string().max(140)` is satisfied by every string, as far as this
 * file can see. Those belong to `requestSchemas.test.ts` and to the route tests, which
 * parse real values. It also says nothing about endpoints no client method calls; the
 * list of those is asserted below rather than left implicit, because a contract test
 * whose blind spots are unknown gets trusted for more than it does.
 */

const ROOT = process.cwd()
const CLIENT = join(ROOT, 'web/src/lib/api/client.ts')
const CLIENT_DTO = join(ROOT, 'web/src/lib/api/dto.ts')
const SERVER_ENTRY = join(ROOT, 'src/interface/http/server.ts')
const ROUTES = join(ROOT, 'src/interface/http/routes')

const sourceOf = (path: string): ts.SourceFile =>
  ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.ES2022, true)

// ------------------------------------------------------------------- shapes --

/**
 * Whether the client always sends a key, or only sometimes.
 *
 * The distinction is the whole reason `...(query.cursor ? { cursor } : {})` is legal
 * against a schema that makes `cursor` optional and would not be against one that
 * required it.
 */
type Presence = 'always' | 'sometimes'
type Keys = ReadonlyMap<string, Presence>

const record = (into: Map<string, Presence>, key: string, presence: Presence): void => {
  // A key sent unconditionally on one path and conditionally on another is still always
  // sent on that first path, so the stronger claim wins.
  if (into.get(key) === 'always') return
  into.set(key, presence)
}

/** `readonly foo?: string` -> `foo` is optional. Interfaces only; aliases carry no keys. */
const interfacesIn = (source: ts.SourceFile, into: Map<string, Keys>): void => {
  for (const statement of source.statements) {
    if (!ts.isInterfaceDeclaration(statement)) continue
    const fields = new Map<string, Presence>()
    for (const member of statement.members) {
      if (!ts.isPropertySignature(member)) continue
      fields.set(
        member.name.getText(source),
        member.questionToken === undefined ? 'always' : 'sometimes',
      )
    }
    into.set(statement.name.text, fields)
  }
}

const clientSource = sourceOf(CLIENT)
const clientDtoSource = sourceOf(CLIENT_DTO)

/** Every shape the client can hand to `transport` as a whole body. */
const CLIENT_SHAPES = ((): ReadonlyMap<string, Keys> => {
  const shapes = new Map<string, Keys>()
  interfacesIn(clientDtoSource, shapes)
  interfacesIn(clientSource, shapes)
  return shapes
})()

// ------------------------------------------------------------------- client --

type Verb = 'GET' | 'POST' | 'PATCH' | 'DELETE'

/** `transport`'s own vocabulary. `del` carries no body, which is why it has no payload. */
const VERBS: Readonly<Record<string, Verb>> = {
  get: 'GET',
  post: 'POST',
  patch: 'PATCH',
  del: 'DELETE',
  upload: 'POST',
}

/** What a call puts in the request, and therefore which schema has to accept it. */
type Payload = 'body' | 'query' | 'none'

interface ClientCall {
  /** The method on `api`, so a failure names the function a reader can open. */
  readonly name: string
  readonly verb: Verb
  /** The path as a pattern: literal text kept, one wildcard per interpolated parameter. */
  readonly path: string
  readonly payload: Payload
  readonly keys: Keys
  /** False when the payload expression could not be read; asserted on, never skipped. */
  readonly resolved: boolean
}

/** A URL the client builds for something other than `transport` — `EventSource`, `<a>`. */
interface ClientLink {
  readonly name: string
  readonly path: string
}

const PARAM = '*'

/** A path expression as a pattern: literal text kept, every interpolation a `*`. */
const pathOf = (node: ts.Expression): string | null => {
  if (ts.isStringLiteralLike(node)) return node.text
  if (!ts.isTemplateExpression(node)) return null
  return node.templateSpans.reduce(
    (text, span) => `${text}${PARAM}${span.literal.text}`,
    node.head.text,
  )
}

const parameterType = (fn: ts.ArrowFunction, name: string): ts.TypeNode | null => {
  for (const parameter of fn.parameters) {
    if (ts.isIdentifier(parameter.name) && parameter.name.text === name) {
      return parameter.type ?? null
    }
  }
  return null
}

/** `CreateEventInput` / `Partial<EventSettingsDto>` -> the keys that type declares. */
const keysOfType = (
  type: ts.TypeNode,
  presence: Presence,
  into: Map<string, Presence>,
): boolean => {
  if (!ts.isTypeReferenceNode(type)) return false
  const name = type.typeName.getText(clientSource)

  if (name === 'Partial') {
    const inner = type.typeArguments?.[0]
    // Everything a `Partial<T>` carries is optional, whatever `T` said.
    return inner !== undefined && keysOfType(inner, 'sometimes', into)
  }

  const shape = CLIENT_SHAPES.get(name)
  if (shape === undefined) return false
  for (const [key, own] of shape) {
    record(into, key, presence === 'sometimes' ? 'sometimes' : own)
  }
  return true
}

/**
 * The keys of whatever the client passes as a payload.
 *
 * Handles the three forms this client actually uses: an object literal, a parameter
 * typed by an interface declared in `client.ts` or `dto.ts`, and the conditional spread
 * (`...(caption ? { caption } : {})`) that expresses "send this key only sometimes".
 * Anything else returns false, and the test that asserts on that is what keeps an
 * unreadable payload from looking like an empty one.
 */
const keysOf = (
  node: ts.Expression,
  fn: ts.ArrowFunction,
  presence: Presence,
  into: Map<string, Presence>,
): boolean => {
  if (ts.isParenthesizedExpression(node)) return keysOf(node.expression, fn, presence, into)

  if (ts.isConditionalExpression(node)) {
    const whenTrue = keysOf(node.whenTrue, fn, 'sometimes', into)
    const whenFalse = keysOf(node.whenFalse, fn, 'sometimes', into)
    return whenTrue && whenFalse
  }

  if (ts.isObjectLiteralExpression(node)) {
    for (const member of node.properties) {
      if (ts.isSpreadAssignment(member)) {
        if (!keysOf(member.expression, fn, presence, into)) return false
        continue
      }
      if (!ts.isPropertyAssignment(member) && !ts.isShorthandPropertyAssignment(member)) {
        return false
      }
      record(into, member.name.getText(clientSource), presence)
    }
    return true
  }

  if (ts.isIdentifier(node)) {
    // `transport.get(path, undefined, signal)`: a call that deliberately sends nothing.
    if (node.text === 'undefined') return true
    const type = parameterType(fn, node.text)
    return type !== null && keysOfType(type, presence, into)
  }

  return false
}

/**
 * Walks a function body, tracking whether the node is reached only on a branch.
 *
 * `if (caption !== '') form.append('caption', caption)` sends a key sometimes; the
 * `form.append('photos', file)` above it sends one always. Reading multipart fields any
 * other way would have to assume which.
 */
const walkBranching = (
  node: ts.Node,
  conditional: boolean,
  visit: (node: ts.Node, conditional: boolean) => void,
): void => {
  visit(node, conditional)
  ts.forEachChild(node, (child) => {
    const branched =
      conditional ||
      (ts.isIfStatement(node) && child !== node.expression) ||
      (ts.isConditionalExpression(node) && child !== node.condition)
    walkBranching(child, branched, visit)
  })
}

/** The named parts of a multipart body, from the `form.append(...)` calls that add them. */
const multipartFields = (fn: ts.ArrowFunction, formName: string): Keys => {
  const fields = new Map<string, Presence>()
  walkBranching(fn, false, (node, conditional) => {
    if (!ts.isCallExpression(node)) return
    const callee = node.expression
    if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== 'append') return
    if (!ts.isIdentifier(callee.expression) || callee.expression.text !== formName) return
    const field = node.arguments[0]
    if (field !== undefined && ts.isStringLiteralLike(field)) {
      record(fields, field.text, conditional ? 'sometimes' : 'always')
    }
  })
  return fields
}

/** The object literal `createApi` returns: one property per endpoint. */
const apiSurface = ((): ts.ObjectLiteralExpression => {
  for (const statement of clientSource.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== 'createApi') continue
      const initializer = declaration.initializer
      if (initializer === undefined || !ts.isArrowFunction(initializer)) continue
      const body = ts.isParenthesizedExpression(initializer.body)
        ? initializer.body.expression
        : initializer.body
      if (ts.isObjectLiteralExpression(body)) return body
    }
  }
  throw new Error(`createApi's returned object literal was not found in ${CLIENT}`)
})()

const { CLIENT_CALLS, CLIENT_LINKS } = ((): {
  CLIENT_CALLS: readonly ClientCall[]
  CLIENT_LINKS: readonly ClientLink[]
} => {
  const calls: ClientCall[] = []
  const links: ClientLink[] = []

  for (const property of apiSurface.properties) {
    if (!ts.isPropertyAssignment(property)) continue
    if (!ts.isArrowFunction(property.initializer)) continue
    const name = property.name.getText(clientSource)
    const fn = property.initializer

    // A link builder returns the URL rather than requesting it: `albumUrl`, `streamUrl`.
    const returned = ts.isParenthesizedExpression(fn.body) ? fn.body.expression : fn.body
    if (!ts.isBlock(returned)) {
      const literal = pathOf(returned)
      if (literal !== null) {
        links.push({ name, path: literal })
        continue
      }
    }

    walkBranching(fn, false, (node) => {
      if (!ts.isCallExpression(node)) return
      const callee = node.expression
      if (!ts.isPropertyAccessExpression(callee)) return
      if (!ts.isIdentifier(callee.expression) || callee.expression.text !== 'transport') return

      const verb = VERBS[callee.name.text]
      const path = node.arguments[0] === undefined ? null : pathOf(node.arguments[0])
      if (verb === undefined || path === null) {
        calls.push({
          name,
          verb: 'GET',
          path: '',
          payload: 'none',
          keys: new Map(),
          resolved: false,
        })
        return
      }

      const keys = new Map<string, Presence>()
      const payloadNode = node.arguments[1]

      if (callee.name.text === 'upload') {
        const form =
          payloadNode !== undefined && ts.isIdentifier(payloadNode) ? payloadNode.text : null
        if (form === null) {
          calls.push({ name, verb, path, payload: 'body', keys, resolved: false })
          return
        }
        for (const [field, presence] of multipartFields(fn, form)) record(keys, field, presence)
        calls.push({ name, verb, path, payload: 'body', keys, resolved: true })
        return
      }

      const payload: Payload =
        callee.name.text === 'get' ? 'query' : callee.name.text === 'del' ? 'none' : 'body'

      if (payload === 'none' || payloadNode === undefined) {
        calls.push({ name, verb, path, payload: 'none', keys, resolved: true })
        return
      }

      const resolved = keysOf(payloadNode, fn, 'always', keys)
      calls.push({ name, verb, path, payload, keys, resolved })
    })
  }

  return { CLIENT_CALLS: calls, CLIENT_LINKS: links }
})()

// ------------------------------------------------------------------- server --

interface ServerRoute {
  readonly verb: Verb
  /** `/api/events/:eventSlug/moderators`, mount prefix included. */
  readonly declared: string
  /** The same path with every `:param` reduced to `*`, for matching. */
  readonly path: string
  readonly bodySchema: string | null
  readonly querySchema: string | null
  /** Field names multer consumes before `req.body` is parsed — files, never zod's. */
  readonly fileFields: readonly string[]
}

const ROUTER_VERBS: Readonly<Record<string, Verb>> = {
  get: 'GET',
  post: 'POST',
  patch: 'PATCH',
  delete: 'DELETE',
}

/** `app.use('/api', eventRoutes(deps))` — both the prefix and the order Express matches in. */
const MOUNTS = ((): ReadonlyMap<string, { prefix: string; order: number }> => {
  const mounts = new Map<string, { prefix: string; order: number }>()
  const source = sourceOf(SERVER_ENTRY)
  let order = 0

  const walk = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      if (node.expression.name.text === 'use') {
        const [first, second] = node.arguments
        if (
          first !== undefined &&
          ts.isStringLiteralLike(first) &&
          second !== undefined &&
          ts.isCallExpression(second) &&
          ts.isIdentifier(second.expression)
        ) {
          mounts.set(second.expression.text, { prefix: first.text, order })
          order += 1
        }
      }
    }
    ts.forEachChild(node, walk)
  }

  walk(source)
  return mounts
})()

/** The `export const xRoutes = …` a `router.get(…)` call sits inside. */
const enclosingFactory = (node: ts.Node): string | null => {
  let current: ts.Node | undefined = node
  while (current !== undefined) {
    if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name)) return current.name.text
    current = current.parent
  }
  return null
}

/** `const PHOTOS_FIELD = 'photos'` — resolved so the field name stays the server's. */
const stringConstant = (source: ts.SourceFile, name: string): string | null => {
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== name) continue
      const initializer = declaration.initializer
      if (initializer !== undefined && ts.isStringLiteralLike(initializer)) return initializer.text
    }
  }
  return null
}

const SERVER_ROUTES = ((): readonly ServerRoute[] => {
  const found: { route: ServerRoute; order: number; index: number }[] = []
  let index = 0

  for (const entry of readdirSync(ROUTES)) {
    if (!entry.endsWith('.ts') || entry.endsWith('.test.ts')) continue
    const source = sourceOf(join(ROUTES, entry))

    const walk = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const verb = ROUTER_VERBS[node.expression.name.text]
        const target = node.expression.expression
        const declared = node.arguments[0]

        if (
          verb !== undefined &&
          ts.isIdentifier(target) &&
          target.text === 'router' &&
          declared !== undefined &&
          ts.isStringLiteralLike(declared)
        ) {
          const factory = enclosingFactory(node)
          const mount = factory === null ? undefined : MOUNTS.get(factory)
          if (mount !== undefined) {
            const path = `${mount.prefix}${declared.text}`
            let bodySchema: string | null = null
            let querySchema: string | null = null
            const fileFields: string[] = []

            const inspect = (inner: ts.Node): void => {
              if (ts.isCallExpression(inner) && ts.isPropertyAccessExpression(inner.expression)) {
                const member = inner.expression.name.text
                const receiver = inner.expression.expression
                const argument = inner.arguments[0]

                // `someBody.parse(req.body)` — the schema this route parses with.
                if (member === 'parse' && ts.isIdentifier(receiver) && argument !== undefined) {
                  if (ts.isPropertyAccessExpression(argument)) {
                    if (argument.name.text === 'body') bodySchema = receiver.text
                    if (argument.name.text === 'query') querySchema = receiver.text
                  }
                }

                // `uploads.array(PHOTOS_FIELD)` — multer eats these before zod sees them.
                if ((member === 'array' || member === 'single') && argument !== undefined) {
                  if (ts.isStringLiteralLike(argument)) fileFields.push(argument.text)
                  if (ts.isIdentifier(argument)) {
                    const resolved = stringConstant(source, argument.text)
                    if (resolved !== null) fileFields.push(resolved)
                  }
                }
              }
              ts.forEachChild(inner, inspect)
            }
            ts.forEachChild(node, inspect)

            found.push({
              order: mount.order,
              index,
              route: {
                verb,
                declared: path,
                path: path.replace(/:[^/]+/g, PARAM),
                bodySchema,
                querySchema,
                fileFields,
              },
            })
            index += 1
          }
        }
      }
      ts.forEachChild(node, walk)
    }

    walk(source)
  }

  // Express tries routers in mount order and routes in declaration order, and two
  // patterns here genuinely overlap (`/photos/mine` under `/photos/:photoId`), so the
  // order a client call is resolved in has to be the server's own.
  return found
    .sort((left, right) => left.order - right.order || left.index - right.index)
    .map((entry) => entry.route)
})()

const segmentsOf = (path: string): readonly string[] =>
  path.split('/').filter((part) => part !== '')

/** Express's own resolution: an exact path wins, otherwise the first pattern that fits. */
const routeFor = (call: ClientCall): ServerRoute | null => {
  const wanted = segmentsOf(call.path)
  const candidates = SERVER_ROUTES.filter((route) => route.verb === call.verb)

  const exact = candidates.find((route) => route.path === call.path)
  if (exact !== undefined) return exact

  return (
    candidates.find((route) => {
      const declared = segmentsOf(route.path)
      if (declared.length !== wanted.length) return false
      return declared.every((part, at) => part === PARAM || part === wanted[at])
    }) ?? null
  )
}

// ------------------------------------------------------------------ pairing --

const SCHEMAS: Readonly<Record<string, unknown>> = { ...requestSchemas }

const asObjectSchema = (name: string): z.AnyZodObject | null => {
  const schema = SCHEMAS[name]
  return schema instanceof z.ZodObject ? schema : null
}

interface Pairing {
  readonly name: string
  readonly verb: Verb
  readonly declared: string
  readonly payload: Payload
  readonly schemaName: string
  readonly schema: z.AnyZodObject
  readonly keys: Keys
  readonly fileFields: readonly string[]
}

const MATCHED = CLIENT_CALLS.map((call) => ({ call, route: routeFor(call) }))

const PAIRINGS: readonly Pairing[] = MATCHED.flatMap(({ call, route }) => {
  if (route === null || call.payload === 'none') return []
  const schemaName = call.payload === 'body' ? route.bodySchema : route.querySchema
  if (schemaName === null) return []
  const schema = asObjectSchema(schemaName)
  if (schema === null) return []
  return [
    {
      name: call.name,
      verb: call.verb,
      declared: route.declared,
      payload: call.payload,
      schemaName,
      schema,
      keys: call.keys,
      fileFields: route.fileFields,
    },
  ]
})

/**
 * The value every probe below carries.
 *
 * Unknowable and deliberately not guessed: a body's values are what a host or a guest
 * typed. Only the presence of keys is being asserted, and zod reports an unrecognised
 * key whatever its value holds.
 */
const UNKNOWN_AT_REST = null

const probe = (keys: Iterable<string>): Record<string, unknown> =>
  Object.fromEntries([...keys].map((key) => [key, UNKNOWN_AT_REST]))

/**
 * Schemas no request the client can make ever reaches, each with the reason.
 *
 * Not an escape hatch: an unexercised schema is an endpoint with no client, and this
 * file would otherwise report it as covered by saying nothing about it.
 */
const NO_CLIENT_CALLER: Readonly<Record<string, string>> = {
  // `GET /api/events/:slug/photos` — the host's full gallery. Implemented and tested at
  // ring 4, but nothing in `web/src` calls it yet; the console reads the moderation
  // queue instead. `dtoContract.test.ts` records the same gap from the response side.
  photoListQuery: 'GET /api/events/:eventSlug/photos has no client method',
}

// --------------------------------------------------------------------- tests --

describe('the request contract', () => {
  it('read both halves of it at all', () => {
    // Every assertion below is vacuously true against empty maps, so the parsers have to
    // prove they still understand the files they read.
    expect(CLIENT_CALLS.length).toBeGreaterThanOrEqual(25)
    expect(CLIENT_LINKS.length).toBeGreaterThanOrEqual(2)
    expect(SERVER_ROUTES.length).toBeGreaterThanOrEqual(25)
    expect(PAIRINGS.length).toBeGreaterThanOrEqual(12)
    expect(CLIENT_SHAPES.size).toBeGreaterThanOrEqual(15)
  })

  it('could read the payload of every request the client makes', () => {
    // A payload this file cannot parse is not a passing endpoint, it is an unchecked
    // one — and it would look identical to a call that sends nothing.
    const unreadable = MATCHED.filter(({ call }) => !call.resolved).map(({ call }) => call.name)

    expect(
      unreadable,
      'client payloads this test could not read — teach `keysOf` the form',
    ).toEqual([])
  })

  it('addresses a route this server declares, from every client method', () => {
    const unmatched = MATCHED.filter(({ route }) => route === null).map(
      ({ call }) => `${call.name}: ${call.verb} ${call.path}`,
    )

    expect(unmatched, 'client requests no route on this server answers').toEqual([])
  })

  it.each(PAIRINGS)(
    '$schemaName accepts every field $name sends to $verb $declared',
    ({ name, schema, schemaName, keys, fileFields }) => {
      // The half that shipped broken. On a `.strict()` body one undeclared key is
      // `400 request.invalid` for the entire request, so a field the client invents is
      // not a field the server ignores — it is a feature that never works.
      const sent = [...keys.keys()].filter((key) => !fileFields.includes(key))
      const outcome = schema.safeParse(probe(sent))

      const refused = outcome.success
        ? []
        : outcome.error.issues.flatMap((issue) =>
            issue.code === z.ZodIssueCode.unrecognized_keys ? [...issue.keys] : [],
          )

      expect(refused, `${schemaName} would refuse keys ${name} sends`).toEqual([])
    },
  )

  it.each(PAIRINGS)(
    '$name sends every field $schemaName requires of $verb $declared',
    ({ name, schema, schemaName, keys }) => {
      // F4 in one assertion: `moderatorInvitationBody` requires `temporaryPassword` and
      // `inviteModerator` sent `{ email }`, so every invitation a host sent was refused.
      const always = new Set(
        [...keys].flatMap(([key, presence]) => (presence === 'always' ? [key] : [])),
      )

      const missing = Object.entries(schema.shape as z.ZodRawShape)
        .filter(([, field]) => !field.isOptional())
        .map(([key]) => key)
        .filter((key) => !always.has(key))

      expect(missing, `${schemaName} requires fields ${name} does not always send`).toEqual([])
    },
  )

  it('names every schema no client request exercises', () => {
    // The blind spots, written down. A schema that drops off this list has gained a
    // caller and is now covered; one that appears without a reason is a gap nobody
    // decided on.
    const exercised = new Set(PAIRINGS.map((pairing) => pairing.schemaName))
    const declared = new Set(
      SERVER_ROUTES.flatMap((route) => [route.bodySchema, route.querySchema]).flatMap((name) =>
        name === null ? [] : [name],
      ),
    )

    const uncovered = [...declared].filter((name) => !exercised.has(name)).sort()

    expect(uncovered, 'schemas with no client caller — record why in NO_CLIENT_CALLER').toEqual(
      Object.keys(NO_CLIENT_CALLER).sort(),
    )
  })
})

/**
 * The URLs the client hands to `EventSource` instead of to `transport`.
 *
 * They never pass through a schema, so the checks above cannot see them — and one of
 * them was wrong in exactly the way that stays invisible: the moderation console
 * subscribed to `/api/events/:slug/stream`, the wall's **public** channel, while the
 * authorised `/api/events/:slug/moderation/stream` that exists precisely to avoid that
 * was called by nobody. Nothing looked broken, because the frames are identical.
 */
describe('the channels the client opens', () => {
  const MODERATION_LINK = 'moderationStreamUrl'

  it('points every link builder at a route this server serves', () => {
    const unmatched = CLIENT_LINKS.filter(
      (link) =>
        routeFor({
          name: link.name,
          verb: 'GET',
          path: link.path,
          payload: 'none',
          keys: new Map(),
          resolved: true,
        }) === null,
    ).map((link) => `${link.name}: ${link.path}`)

    expect(unmatched, 'links the client builds that address no route').toEqual([])
  })

  it(`refuses ${MODERATION_LINK} without a session`, async () => {
    // Asserted against the path the *client* builds, not a literal repeated here: a
    // console that goes back to the public channel makes this answer 404, not 401, and
    // that is the whole defect.
    const link = CLIENT_LINKS.find((candidate) => candidate.name === MODERATION_LINK)
    expect(link, `${MODERATION_LINK} is missing from the api client`).toBeDefined()

    const harness = buildServerHarness()
    // No event is seeded, so a request that lands on the *public* channel by mistake
    // answers 404 and ends rather than holding an SSE socket open forever.
    const response = await request(harness.app).get((link?.path ?? '').replace(PARAM, 'mariage'))

    expect(response.status).toBe(401)
    expect(response.body).toMatchObject({ error: { code: 'auth.required' } })
  })
})
