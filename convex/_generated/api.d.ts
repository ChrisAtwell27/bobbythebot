/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as betting from "../betting.js";
import type * as bounties from "../bounties.js";
import type * as challenges from "../challenges.js";
import type * as craftle from "../craftle.js";
import type * as crons from "../crons.js";
import type * as servers from "../servers.js";
import type * as shop from "../shop.js";
import type * as subscriptions from "../subscriptions.js";
import type * as teams from "../teams.js";
import type * as tournaments from "../tournaments.js";
import type * as trivia from "../trivia.js";
import type * as users from "../users.js";
import type * as wordle from "../wordle.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  betting: typeof betting;
  bounties: typeof bounties;
  challenges: typeof challenges;
  craftle: typeof craftle;
  crons: typeof crons;
  servers: typeof servers;
  shop: typeof shop;
  subscriptions: typeof subscriptions;
  teams: typeof teams;
  tournaments: typeof tournaments;
  trivia: typeof trivia;
  users: typeof users;
  wordle: typeof wordle;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
