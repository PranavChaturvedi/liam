/**
 * Main orchestrator for Drizzle ORM schema parsing
 */

import type { Module, VariableDeclarator } from '@swc/core'
import { parseSync } from '@swc/core'
import type { Processor, ProcessResult } from '../types.js'
import { isPgTableCall } from './astUtils.js'
import { convertDrizzleTablesToInternal } from './converter.js'
import { parsePgEnumCall } from './enumParser.js'
import { parsePgTableCall, parsePgTableWithComment } from './tableParser.js'
import type { DrizzleEnumDefinition, DrizzleTableDefinition } from './types.js'

/**
 * Parse Drizzle TypeScript schema to extract table definitions using SWC AST
 */
const parseDrizzleSchema = (
  sourceCode: string,
): {
  tables: Record<string, DrizzleTableDefinition>
  enums: Record<string, DrizzleEnumDefinition>
} => {
  // Parse TypeScript code into AST
  const ast = parseSync(sourceCode, {
    syntax: 'typescript',
    target: 'es2022',
  })

  const tables: Record<string, DrizzleTableDefinition> = {}
  const enums: Record<string, DrizzleEnumDefinition> = {}

  // Traverse the AST to find pgTable calls
  visitModule(ast, tables, enums)

  return { tables, enums }
}

/**
 * Visit and traverse the module AST
 */
const visitModule = (
  module: Module,
  tables: Record<string, DrizzleTableDefinition>,
  enums: Record<string, DrizzleEnumDefinition>,
) => {
  for (const item of module.body) {
    if (item.type === 'VariableDeclaration') {
      for (const declarator of item.declarations) {
        visitVariableDeclarator(declarator, tables, enums)
      }
    } else if (
      item.type === 'ExportDeclaration' &&
      item.declaration?.type === 'VariableDeclaration'
    ) {
      for (const declarator of item.declaration.declarations) {
        visitVariableDeclarator(declarator, tables, enums)
      }
    }
  }
}

/**
 * Visit variable declarator to find pgTable, pgEnum, or relations calls
 */
const visitVariableDeclarator = (
  declarator: VariableDeclarator,
  tables: Record<string, DrizzleTableDefinition>,
  enums: Record<string, DrizzleEnumDefinition>,
) => {
  if (!declarator.init || declarator.init.type !== 'CallExpression') return

  const callExpr = declarator.init

  if (isPgTableCall(callExpr)) {
    const table = parsePgTableCall(callExpr)
    if (table) {
      tables[table.name] = table
    }
  } else if (
    declarator.init.type === 'CallExpression' &&
    declarator.init.callee.type === 'MemberExpression' &&
    declarator.init.callee.property.type === 'Identifier' &&
    declarator.init.callee.property.value === '$comment'
  ) {
    // Handle table comments: pgTable(...).comment(...)
    const table = parsePgTableWithComment(declarator.init)
    if (table) {
      tables[table.name] = table
    }
  } else if (
    callExpr.callee.type === 'Identifier' &&
    callExpr.callee.value === 'pgEnum'
  ) {
    const enumDef = parsePgEnumCall(callExpr)
    if (enumDef && declarator.id.type === 'Identifier') {
      enums[declarator.id.value] = enumDef
    }
  }
}

/**
 * Main processor function for Drizzle schemas
 */
const parseDrizzleSchemaString = (
  schemaString: string,
): Promise<ProcessResult> => {
  try {
    const { tables: drizzleTables, enums } = parseDrizzleSchema(schemaString)
    const { tables, errors } = convertDrizzleTablesToInternal(
      drizzleTables,
      enums,
    )

    return Promise.resolve({
      value: { tables },
      errors,
    })
  } catch (error) {
    return Promise.resolve({
      value: { tables: {} },
      errors: [
        new Error(
          `Error parsing Drizzle schema: ${error instanceof Error ? error.message : String(error)}`,
        ),
      ],
    })
  }
}

export const processor: Processor = (str) => parseDrizzleSchemaString(str)
