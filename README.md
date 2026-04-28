# effect-entity-proxy-context-repro

Minimal reproduction for `EntityProxyServer.layerRpcHandlers` registering RPC handler entries with `services` instead of `context`, causing the RPC server to crash when handling entity proxy calls.

## Affected versions

`effect@4.0.0-beta.56` (also reproduces on `4.0.0-beta.57` and `4.0.0-beta.58`).

## Run

```sh
bun install
bun run repro
```

## Expected

```
entity id payload:undefined discard:true
ok
```

## Actual

```
TypeError: undefined is not an object (evaluating 'entry.context.mapUnsafe')
  at handleRequest (.../effect/dist/unstable/rpc/RpcServer.js:226:35)
```

## Root cause

`dist/unstable/cluster/EntityProxyServer.js` registers handlers with a `services` field:

```js
handlers.set(key, {
  services,
  tag,
  handler: ({ entityId, payload }) => client(entityId)[parentRpc._tag](payload),
});

handlers.set(`${key}Discard`, {
  services,
  tag,
  handler: ({ entityId, payload }) =>
    client(entityId)[parentRpc._tag](payload, { discard: true }),
});
```

But `dist/unstable/rpc/RpcServer.js` reads `entry.context`:

```js
const context = new Map(entry.context.mapUnsafe);
```

`RpcGroup.toHandlers` uses the expected `context` field, so renaming `services` to `context` in the two `EntityProxyServer.layerRpcHandlers` entries makes the repro pass.
