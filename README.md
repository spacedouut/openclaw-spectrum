# openclaw-spectrum

OpenClaw channel plugin for [Photon Spectrum](https://photon.codes/docs/spectrum-ts/introduction).
One OpenClaw channel (`spectrum`) that talks to iMessage, Telegram, WhatsApp Business, and Slack
through the Spectrum SDK (`spectrum-ts`), instead of a separate native integration per platform.

- Runs one Spectrum app per configured OpenClaw account and consumes `app.messages`.
- Routes each Spectrum space (DM or group) to an OpenClaw agent session.
- Replies go back through `space.send(...)` as markdown (or plain text) plus attachments.
- Full OpenClaw DM security: `pairing` / `allowlist` / `open` / `disabled`, group policy,
  per-group allowlists, mention gating, and text-command authorization.

## Install

Requires OpenClaw `>= 2026.9.6` and Node `>= 24.16`.

```sh
openclaw plugins install openclaw-spectrum
# or from a checkout
git clone https://github.com/spacedouut/openclaw-spectrum.git
cd openclaw-spectrum && npm install && npm run build
openclaw plugins install --link .
```

## Interactive setup

```sh
openclaw channels add            # pick "Photon Spectrum"
openclaw channels add spectrum --account work
```

The wizard asks whether the account uses Spectrum Cloud (Photon project ID and secret;
iMessage, Telegram, WhatsApp Business, Slack) or self-hosted provider credentials
(Telegram, WhatsApp Business), which providers to enable, and the credentials for each.
When `SPECTRUM_PROJECT_ID`/`SPECTRUM_PROJECT_SECRET`, `SPECTRUM_TELEGRAM_BOT_TOKEN`, or
`SPECTRUM_WHATSAPP_BUSINESS_ACCESS_TOKEN`/`SPECTRUM_WHATSAPP_BUSINESS_PHONE_NUMBER_ID` are set,
it offers to use them and keeps the values out of the config file. Onboarding then offers the
standard DM policy and allowlist prompts. Named accounts are written under
`channels.spectrum.accounts.<id>`.

Non-interactive:

```sh
openclaw channels add spectrum \
  --providers imessage,telegram \
  --project-id "$SPECTRUM_PROJECT_ID" --project-secret "$SPECTRUM_PROJECT_SECRET" \
  --telegram-bot-token "$TELEGRAM_BOT_TOKEN"
```

Other flags: `--whatsapp-access-token`, `--whatsapp-app-secret`, `--whatsapp-phone-number-id`.
iMessage self-hosted clients and Slack tokens are configured by editing the config (below).
Restart the Gateway afterwards: `openclaw gateway restart`.

## Configure

Spectrum runs in two modes:

- **Cloud** — set `projectId` + `projectSecret` from the [Photon dashboard](https://app.photon.codes).
  Photon hosts the provider connections (for example shared iMessage lines).
- **Direct** — omit project credentials and give each provider its own credentials.

Minimal cloud setup with iMessage and Telegram:

```json5
{
  channels: {
    spectrum: {
      projectId: "your-project-id",
      projectSecret: "your-project-secret",
      providers: {
        imessage: true,
        telegram: true,
      },
      dmPolicy: "pairing",
    },
  },
}
```

Direct mode, multiple accounts:

```json5
{
  channels: {
    spectrum: {
      accounts: {
        personal: {
          providers: {
            imessage: {
              clients: [{ address: "imsg.example.com:443", token: "...", phone: "+15551234567" }],
            },
          },
          dmPolicy: "allowlist",
          allowFrom: ["imessage:+15557654321"],
        },
        bot: {
          providers: {
            telegram: { botToken: "123456:ABC..." },
          },
        },
      },
    },
  },
}
```

### Account fields

| Field | Description |
| --- | --- |
| `projectId`, `projectSecret` | Spectrum cloud credentials. For the default account they fall back to `SPECTRUM_PROJECT_ID` / `SPECTRUM_PROJECT_SECRET`. |
| `providers.imessage` | `true` or `{ clients: [{ address, token, phone }] }`. |
| `providers.telegram` | `true` or `{ botToken, webhookSecret?, baseUrl? }`. |
| `providers.whatsappBusiness` | `true` or `{ accessToken, appSecret?, phoneNumberId }`. |
| `providers.slack` | `true` or `{ tokens: { <teamId>: <botToken> }, endpoint? }`. |
| `dmPolicy` | `pairing` (default), `allowlist`, `open` (requires `allowFrom: ["*"]`), `disabled`. |
| `allowFrom` | DM sender allowlist, entries are `<platform>:<userId>`. |
| `groupPolicy` | `allowlist` (default), `open`, `disabled`. |
| `groupAllowFrom` | Group sender allowlist; falls back to `allowFrom`. |
| `groups` | Optional per-space settings keyed by target (`telegram:-100123`) or `*`: `enabled`, `requireMention`, `allowFrom`, `systemPrompt`, `skills`. When set, unlisted groups are dropped. |
| `markdown` | Send replies as Spectrum markdown content (default `true`). |
| `typingIndicator` | Show typing while the agent works (default `true`). |
| `mediaMaxMb` | Inbound/outbound attachment size limit. |
| `defaultTo` | Default target for proactive sends. |

Provider fields that are left out fall back to Spectrum's own environment variables
(`SPECTRUM_TELEGRAM_BOT_TOKEN`, `SPECTRUM_WHATSAPP_BUSINESS_ACCESS_TOKEN`, ...). Keep secrets in env
vars or OpenClaw secret refs rather than the config file.

## Targets and identities

| Form | Meaning |
| --- | --- |
| `telegram:-100123456` | Spectrum space id on a platform (what inbound sessions use). |
| `imessage:any;-;+15551234567` | iMessage DM space. |
| `imessage:user:+15551234567` | Open (or create) a DM with a user. |
| `spectrum:tg:42` | `spectrum:` prefix and platform aliases (`tg`, `imsg`, `wa`) are accepted. |

Sender ids used by `allowFrom`, pairing, and `openclaw pairing approve spectrum <id>` are
`<platform>:<userId>`, for example `telegram:42` or `imessage:+15551234567`.

## Limitations

- Inbound transport is Spectrum's long-lived `app.messages` stream; webhook mode is not wired up.
- DM vs group detection: iMessage uses the space type; Telegram/Slack use id conventions
  (negative Telegram chat ids, non-`D` Slack channels); other platforms assume DM when the space id
  matches the sender.
- Proactive sends to Slack spaces only work for spaces that already messaged the agent (Slack
  space lookup needs a team id).
- Reactions, edits, polls, and other non-message events are not forwarded to the agent; contacts,
  links, and polls are flattened into text.
- Message threading/quote-replies are not mapped; replies are sent to the same space.

## Development

```sh
npm install
npm run check    # typecheck src + tests
npm test         # vitest
npm run build    # emit dist/
npm run manifest # rebuild and regenerate openclaw.plugin.json channelConfigs from the zod schema
```

## License

MIT
