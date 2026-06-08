// SPDX-License-Identifier: GPL-3.0-or-later
// @paritytech

/**
 * Read-only slice of the W3SPayMerchantRegistry ABI. Matches
 * `apps/w3spay-admin/src/shared/api/registry-abi.ts` for the two functions the
 * v1 remote read uses: `getAllTerminalKeys` and `getMerchantByKey`. The
 * processor never writes the registry, so the write functions are omitted.
 */
export const W3SPayMerchantRegistryABI = [
  {
    inputs: [],
    name: "getAllTerminalKeys",
    outputs: [{ internalType: "bytes32[]", name: "", type: "bytes32[]" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "bytes32", name: "key", type: "bytes32" }],
    name: "getMerchantByKey",
    outputs: [
      {
        components: [
          { internalType: "string", name: "merchantId", type: "string" },
          { internalType: "string", name: "terminalId", type: "string" },
          { internalType: "bytes32", name: "destinationAccountId", type: "bytes32" },
          { internalType: "string", name: "displayName", type: "string" },
          { internalType: "enum IW3SPayMerchantRegistry.MerchantStatus", name: "status", type: "uint8" },
          { internalType: "uint64", name: "addedAt", type: "uint64" },
          { internalType: "uint64", name: "updatedAt", type: "uint64" },
          { internalType: "bool", name: "exists", type: "bool" },
        ],
        internalType: "struct IW3SPayMerchantRegistry.MerchantEntry",
        name: "",
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;
