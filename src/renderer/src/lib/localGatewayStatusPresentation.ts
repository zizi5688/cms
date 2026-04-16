import type {
  LocalGatewayAccountSummary,
  LocalGatewayConfig,
  LocalGatewayState
} from '../../../shared/localGatewayTypes.ts'

type LocalGatewayPresentationItem = {
  ready: boolean
  label: string
}

export type LocalGatewayStatusPresentation = {
  overview: LocalGatewayPresentationItem
  chat: LocalGatewayPresentationItem
  flow: LocalGatewayPresentationItem
  admin: LocalGatewayPresentationItem
}

function findService(
  state: LocalGatewayState | null,
  name: LocalGatewayState['services'][number]['name']
) {
  return state?.services.find((service) => service.name === name) ?? null
}

function normalizeProfileDirectory(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

function formatSelectedAccountState(account: LocalGatewayAccountSummary | null): string {
  if (!account) return '未同步到 gateway'
  return account.status
}

function buildSelectedAccountFailureLabel(
  accounts: Array<LocalGatewayAccountSummary | null>,
  selectedDirectories: string[]
): string {
  const details = selectedDirectories.map((profileDirectory, index) => {
    const account = accounts[index] ?? null
    return `${profileDirectory} ${formatSelectedAccountState(account)}`
  })
  return `所选 Chat 账号不可用：${details.join('、')}`
}

export function formatLocalGatewayTimestamp(value: number | null): string {
  const time = Number(value)
  if (!Number.isFinite(time) || time <= 0) return '--'
  const date = new Date(time)
  if (!Number.isFinite(date.getTime())) return '--'
  return date.toLocaleString('zh-CN', { hour12: false })
}

export function resolveLocalGatewayStatusPresentation(input: {
  state: LocalGatewayState | null
  config: LocalGatewayConfig
  accounts: LocalGatewayAccountSummary[]
}): LocalGatewayStatusPresentation {
  if (!input.state) {
    return {
      overview: { ready: false, label: '正在读取本地网关状态。' },
      chat: { ready: false, label: '正在读取状态。' },
      flow: { ready: false, label: '正在读取状态。' },
      admin: { ready: false, label: '正在读取状态。' }
    }
  }

  if (!input.config.enabled) {
    return {
      overview: { ready: false, label: '本地网关未启用。' },
      chat: { ready: false, label: '未启用本地网关管理。' },
      flow: { ready: false, label: '未启用本地网关管理。' },
      admin: { ready: false, label: '未启用本地网关管理。' }
    }
  }

  const selectedDirectories = input.config.chromeProfileDirectories
    .map((value) => normalizeProfileDirectory(value))
    .filter(Boolean)
  const accountsByProfileDirectory = new Map(
    input.accounts
      .map((account) => [normalizeProfileDirectory(account.chromeProfileDirectory), account] as const)
      .filter(([profileDirectory]) => profileDirectory.length > 0)
  )
  const selectedAccounts = selectedDirectories.map((profileDirectory) => {
    return accountsByProfileDirectory.get(profileDirectory) ?? null
  })
  const hasSelectedAccount = selectedDirectories.length > 0
  const hasActiveSelectedAccount = selectedAccounts.some((account) => account?.status === 'active')
  const primarySelectedAccount = selectedAccounts[0] ?? null

  const adapterService = findService(input.state, 'adapter')
  const gatewayService = findService(input.state, 'gateway')
  const adminUiService = findService(input.state, 'adminUi')
  const cdpProxyService = findService(input.state, 'cdpProxy')
  const chromeDebugService = findService(input.state, 'chromeDebug')

  const chat: LocalGatewayPresentationItem =
    !adapterService?.ok || !gatewayService?.ok
      ? {
          ready: false,
          label: adapterService?.message ?? gatewayService?.message ?? 'Chat 基础服务未就绪。'
        }
      : !hasSelectedAccount
        ? { ready: false, label: '未选择 Chat 账号。' }
        : !hasActiveSelectedAccount
          ? {
              ready: false,
              label: buildSelectedAccountFailureLabel(selectedAccounts, selectedDirectories)
            }
          : input.state.capabilityChecks.chat.ok
            ? { ready: true, label: '正常' }
            : {
                ready: false,
                label: input.state.capabilityChecks.chat.message ?? '真实聊天请求未通过。'
              }

  const flow: LocalGatewayPresentationItem =
    !input.config.startCdpProxy
      ? { ready: false, label: '未启用 CDP 代理。' }
      : !hasSelectedAccount
        ? { ready: false, label: '未选择可复用的 Chat Profile。' }
        : primarySelectedAccount?.status !== 'active'
          ? {
              ready: false,
              label: primarySelectedAccount
                ? `主 Chat 账号当前为 ${primarySelectedAccount.status}。`
                : `主 Chat 账号未同步：${selectedDirectories[0]}`
            }
          : !cdpProxyService?.ok || !chromeDebugService?.ok
            ? {
                ready: false,
                label:
                  cdpProxyService?.message ??
                  chromeDebugService?.message ??
                  '生图运行时未就绪。'
              }
            : input.state.capabilityChecks.image.ok
              ? { ready: true, label: '正常' }
              : {
                  ready: false,
                  label: input.state.capabilityChecks.image.message ?? '真实生图请求未通过。'
                }

  const admin: LocalGatewayPresentationItem =
    !input.config.startAdminUi
      ? { ready: false, label: '未启用管理后台。' }
      : adminUiService?.ok
        ? { ready: true, label: '正常' }
        : {
            ready: false,
            label: adminUiService?.message ?? '管理后台未就绪。'
          }

  if (input.state.overallStatus === 'starting') {
    return {
      overview: { ready: false, label: '网关启动中。' },
      chat,
      flow,
      admin
    }
  }

  const firstFailure = [
    !chat.ready ? `Chat：${chat.label}` : '',
    !flow.ready ? `Flow：${flow.label}` : '',
    !admin.ready ? `管理后台：${admin.label}` : ''
  ].find(Boolean)

  return {
    overview: firstFailure
      ? { ready: false, label: firstFailure }
      : { ready: true, label: '真实链路正常' },
    chat,
    flow,
    admin
  }
}
