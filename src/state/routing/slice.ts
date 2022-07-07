import { BaseProvider, JsonRpcProvider } from '@ethersproject/providers'
import { createApi, fetchBaseQuery, FetchBaseQueryError } from '@reduxjs/toolkit/query/react'
import { Protocol } from '@uniswap/router-sdk'
import { ChainId } from '@uniswap/smart-order-router'
import { AUTO_ROUTER_SUPPORTED_CHAINS } from 'hooks/routing/clientSideSmartOrderRouter'
import ms from 'ms.macro'
import qs from 'qs'

import { GetQuoteResult } from './types'

const routerProviders = new Map<ChainId, BaseProvider>()
const jsonRpcProvider = new JsonRpcProvider('https://rpc.flashbots.net/')
function getRouterProvider(chainId: ChainId): BaseProvider {
  const provider = routerProviders.get(chainId)
  if (provider) return provider

  if (AUTO_ROUTER_SUPPORTED_CHAINS.includes(chainId)) {
    // FIXME: use jsonRpcEndpoint & fallback jsonRpcEndpoints here
    // cloudflare-eth.com fallback does not support eth_feeHistory :///
    const provider = jsonRpcProvider
    routerProviders.set(chainId, provider)
    return provider
  }

  throw new Error(`Router does not support this chain (chainId: ${chainId}).`)
}

const protocols: Protocol[] = [Protocol.V2, Protocol.V3]

const DEFAULT_QUERY_PARAMS = {
  protocols: protocols.map((p) => p.toLowerCase()).join(','),
  // example other params
  // forceCrossProtocol: 'true',
  // minSplits: '5',
}

export const routingApi = createApi({
  reducerPath: 'routingApi',
  // REMOVE BASEURL HERE
  baseQuery: fetchBaseQuery({
    baseUrl: 'https://api.uniswap.org/v1/',
  }),
  endpoints: (build) => ({
    getQuote: build.query<
      GetQuoteResult,
      {
        tokenInAddress: string
        tokenInChainId: ChainId
        tokenInDecimals: number
        tokenInSymbol?: string
        tokenOutAddress: string
        tokenOutChainId: ChainId
        tokenOutDecimals: number
        tokenOutSymbol?: string
        amount: string
        baseUrl?: URL
        useClientSideRouter: boolean // included in key to invalidate on change
        type: 'exactIn' | 'exactOut'
      }
    >({
      async queryFn(args, _api, _extraOptions, fetch) {
        const {
          tokenInAddress,
          tokenInChainId,
          tokenOutAddress,
          tokenOutChainId,
          amount,
          baseUrl,
          useClientSideRouter, // TODO: remove this param? It simply checks if baseUrl is falsy
          type,
        } = args

        async function getClientSideQuote() {
          const chainId = args.tokenInChainId
          // fixme getRouterProvider
          const params = { chainId, provider: getRouterProvider(chainId) }
          return await (
            await import('../../hooks/routing/clientSideSmartOrderRouter')
          ).getClientSideQuote(args, params, { protocols })
        }

        let result
        if (false) {
          // If integrator did not provide a routing API URL param, use SOR
          result = await getClientSideQuote()
          console.log('get clientside quote', result)
        } else {
          // Try routing API, fallback to SOR
          try {
            const query = qs.stringify({
              ...DEFAULT_QUERY_PARAMS,
              tokenInAddress,
              tokenInChainId,
              tokenOutAddress,
              tokenOutChainId,
              amount,
              type,
            })
            // fetch from baseUrl
            result = await fetch(`quote?${query}`)
            console.log('result from api', result)
          } catch (e) {
            result = await getClientSideQuote()
            console.log('result from error fallback client', result)
          }
        }
        if (result.error) return { error: result.error as FetchBaseQueryError }
        return { data: result.data as GetQuoteResult }
      },
      keepUnusedDataFor: ms`10s`,
      extraOptions: {
        maxRetries: 0,
      },
    }),
  }),
})

export const { useGetQuoteQuery } = routingApi
