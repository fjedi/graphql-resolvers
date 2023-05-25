import { GraphQLFieldResolver, GraphQLResolveInfo } from 'graphql';
import { DatabaseModels, DatabaseTransaction } from '@fjedi/database-client';
import { DefaultError } from '@fjedi/errors';
import { reduce as reducePromise } from 'bluebird';

export function removeUndefinedValues(values: { [key: string]: any }) {
  const res: { [key: string]: any } = {};
  Object.keys(values).forEach((key) => {
    if (typeof values[key] !== 'undefined') {
      res[key] = values[key];
    }
  });
  return res;
}
//
export type FieldValue = unknown;
export type FieldResolverParams<TContext, TParent, TArgs = unknown> = {
  getDataFromParent?: (
    rootValue: TParent,
    args: TArgs,
    context: TContext,
    info: GraphQLResolveInfo,
  ) => FieldValue;
};

//
export function fieldResolver<TContext, TParent, TArgs = unknown, TResult = unknown>(
  defaultResolver: GraphQLFieldResolver<TParent, TContext, TArgs>,
  p?: FieldResolverParams<TContext, TParent, TArgs>,
) {
  return function resolve(
    rootValue: TParent,
    args: TArgs,
    context: TContext,
    info: GraphQLResolveInfo,
  ): unknown {
    const { fieldName } = info;
    const { getDataFromParent } = p || {};
    const fieldValue =
      typeof getDataFromParent === 'function'
        ? getDataFromParent(rootValue, args, context, info)
        : // @ts-ignore
          rootValue?.[fieldName];
    //
    if (typeof fieldValue !== 'undefined') {
      return fieldValue;
    }
    //
    return defaultResolver(rootValue, args, context, info);
  };
}

export type CheckAccessFn<TContext, TArgs = unknown> = (
  context: TContext,
  args?: TArgs,
) => Promise<boolean>;

//
export type ResolveInstanceByIdArgs = { [k: string]: unknown };
export type ResolveInstanceByIdOptions<TContext, TInstance, TArgs> = {
  primaryKey?: string;
  checkAccess?: (context: TContext, args: TArgs) => Promise<boolean>;
  checkInstanceAccess?: (context: TContext, instance: TInstance, args: TArgs) => Promise<boolean>;
};
export function resolveInstanceById<
  TContext extends { state: { [k: string]: unknown } },
  TInstance,
  TArgs extends ResolveInstanceByIdArgs = ResolveInstanceByIdArgs,
>(
  modelName: keyof DatabaseModels,
  options?: ResolveInstanceByIdOptions<TContext, TInstance, TArgs>,
) {
  return async function resolve<TParent>(
    _: TParent,
    args: TArgs,
    context: TContext,
    resolveInfo: GraphQLResolveInfo,
  ): Promise<TInstance> {
    const { checkAccess, checkInstanceAccess } = options ?? {};
    if (typeof checkAccess === 'function' && !(await checkAccess(context, args))) {
      throw new DefaultError('Access is denied', { status: 403 });
    }
    const {
      // @ts-ignore
      db: {
        helpers: { dbInstanceById },
      },
    } = context;

    const instance = (await dbInstanceById(modelName, args.id, {
      resolveInfo,
      context,
    })) as TInstance;

    if (
      !instance ||
      // @ts-ignore
      !(instance instanceof context.db.models[modelName])
    ) {
      throw new DefaultError('No entry with such id found', { status: 404 });
    }

    if (
      typeof checkInstanceAccess === 'function' &&
      !(await checkInstanceAccess(context, instance, args))
    ) {
      throw new DefaultError('Access is denied', { status: 403 });
    }

    return instance;
  };
}
//
export type UpdateInstanceByIdArgs = ResolveInstanceByIdArgs & { input: { [k: string]: unknown } };
export type UpdateInstanceByIdOptions<TContext, TInstance, TArgs> = {
  primaryKey?: string;
  checkAccess?: (context: TContext, args: TArgs) => Promise<boolean>;
  checkInstanceAccess?: (context: TContext, instance: TInstance, args: TArgs) => Promise<boolean>;
  preprocessInputData?: (
    context: TContext,
    instance: TInstance,
    args: TArgs,
  ) => Promise<UpdateInstanceByIdArgs>;
  beforeTransaction?: (context: TContext, args: TArgs, instance: TInstance) => Promise<unknown>;
  afterTransaction?: (context: TContext, args: TArgs, instance: TInstance) => Promise<unknown>;
  insideTransaction?: (
    context: TContext,
    args: TArgs,
    instance: TInstance,
    transaction: DatabaseTransaction,
  ) => Promise<unknown>;
};
export function updateInstanceById<
  TContext extends { state: { [k: string]: unknown } },
  TInstance,
  TArgs extends UpdateInstanceByIdArgs = UpdateInstanceByIdArgs,
>(
  modelName: keyof DatabaseModels,
  options?: UpdateInstanceByIdOptions<TContext, TInstance, TArgs>,
) {
  return async function resolve(_: unknown, args: TArgs, context: TContext): Promise<TInstance> {
    const {
      // @ts-ignore
      db: {
        helpers: { dbInstanceById, wrapInTransaction },
      },
    } = context;
    //
    const {
      primaryKey = 'id',
      preprocessInputData,
      beforeTransaction,
      insideTransaction,
      afterTransaction,
      checkAccess,
      checkInstanceAccess,
    } = options || {};
    if (
      !context.state.viewer ||
      (typeof checkAccess === 'function' && !(await checkAccess(context, args)))
    ) {
      throw new DefaultError('Access is denied', { status: 403 });
    }
    const instance = (await dbInstanceById(modelName, args[primaryKey], {
      context,
      cachePolicy: 'no-cache', // We shouldn't use cache for instances returned as mutations' result
    })) as TInstance;
    if (
      !instance ||
      // @ts-ignore
      !(instance instanceof context.db.models[modelName])
    ) {
      throw new DefaultError('No entry with such id found', { status: 404 });
    }
    if (
      typeof checkInstanceAccess === 'function' &&
      !(await checkInstanceAccess(context, instance, args))
    ) {
      throw new DefaultError('Access is denied', { status: 403 });
    }
    //
    const { input } =
      typeof preprocessInputData === 'function'
        ? await preprocessInputData(context, instance, args)
        : args;
    //
    const updates = removeUndefinedValues(input);
    //
    if (Object.keys(updates).length === 0) {
      return Promise.resolve(instance);
    }
    //
    if (typeof beforeTransaction === 'function') {
      await beforeTransaction(context, args, instance);
    }
    //
    await wrapInTransaction(async (transaction: DatabaseTransaction) => {
      if (typeof insideTransaction === 'function') {
        await insideTransaction(context, args, instance, transaction);
      }
      // @ts-ignore
      await instance.update(updates, {
        transaction,
      });
    });
    if (typeof afterTransaction === 'function') {
      await afterTransaction(context, args, instance);
    }

    return Promise.resolve(instance);
  };
}
//
export type DestroyInstanceByIdArgs = ResolveInstanceByIdArgs;
export type DestroyInstanceByIdOptions<TContext, TInstance, TArgs> = {
  primaryKey?: string;
  checkAccess?: CheckAccessFn<TContext, TArgs>;
  checkInstanceAccess?: (context: TContext, instance: TInstance, args: TArgs) => Promise<boolean>;
  beforeTransaction?: (context: TContext, args: TArgs, instance: TInstance) => Promise<unknown>;
  afterTransaction?: (context: TContext, args: TArgs, instance: TInstance) => Promise<unknown>;
  insideTransaction?: (
    context: TContext,
    args: TArgs,
    instance: TInstance,
    transaction: DatabaseTransaction,
  ) => Promise<unknown>;
};
export function destroyInstanceById<
  TContext extends { state: { [k: string]: unknown } },
  TInstance,
  TArgs extends DestroyInstanceByIdArgs = DestroyInstanceByIdArgs,
>(
  modelName: keyof DatabaseModels,
  options?: DestroyInstanceByIdOptions<TContext, TInstance, TArgs>,
) {
  return async function resolve(_: unknown, args: TArgs, context: TContext): Promise<TInstance> {
    const {
      // @ts-ignore
      db: {
        helpers: { dbInstanceById, wrapInTransaction },
      },
    } = context;
    //
    const {
      primaryKey = 'id',
      beforeTransaction,
      insideTransaction,
      afterTransaction,
      checkAccess,
      checkInstanceAccess,
    } = options || {};
    if (
      !context.state.viewer ||
      (typeof checkAccess === 'function' && !(await checkAccess(context, args)))
    ) {
      throw new DefaultError('Access is denied', { status: 403 });
    }
    const instance = (await dbInstanceById(modelName, args[primaryKey], {
      context,
      cachePolicy: 'no-cache', // We shouldn't use cache for instances returned as mutations' result
    })) as TInstance;
    if (!instance) {
      throw new DefaultError('No entry with such id found', { status: 404 });
    }
    if (
      typeof checkInstanceAccess === 'function' &&
      !(await checkInstanceAccess(context, instance, args))
    ) {
      throw new DefaultError('Access is denied', { status: 403 });
    }
    //
    if (typeof beforeTransaction === 'function') {
      await beforeTransaction(context, args, instance);
    }
    await wrapInTransaction(async (transaction: DatabaseTransaction) => {
      if (typeof insideTransaction === 'function') {
        await insideTransaction(context, args, instance, transaction);
      }
      // @ts-ignore
      await instance.destroy({
        transaction,
      });
    });

    if (typeof afterTransaction === 'function') {
      await afterTransaction(context, args, instance);
    }

    return instance;
  };
}

export type AccessRulesTree<TContext, TArgs = unknown> = {
  and?: CheckAccessFn<TContext, TArgs>[];
  or?: CheckAccessFn<TContext, TArgs>[];
};

export type Checks<TContext, TArgs = unknown> =
  | AccessRulesTree<TContext, TArgs>
  | CheckAccessFn<TContext, TArgs>[];

export async function allChecksPassed<TContext, TArgs = unknown>(
  checks: CheckAccessFn<TContext, TArgs>[],
  context: TContext,
  args?: TArgs,
) {
  return reducePromise(
    checks,
    async (allowed, check) => {
      if (!allowed) {
        return allowed;
      }
      return check(context, args);
    },
    true,
  );
}

export async function oneCheckPassed<TContext, TArgs = unknown>(
  checks: CheckAccessFn<TContext, TArgs>[],
  context: TContext,
  args?: TArgs,
) {
  return reducePromise(
    checks,
    async (allowed, check) => {
      if (allowed) {
        return allowed;
      }
      return check(context, args);
    },
    false,
  );
}

export function resolverGuard<TContext, TArgs = unknown>(
  resolver: GraphQLFieldResolver<unknown, TContext, TArgs>,
  checks: Checks<TContext, TArgs>,
) {
  return async function resolve(
    _: unknown,
    args: TArgs,
    context: TContext,
    info: GraphQLResolveInfo,
  ): Promise<unknown> {
    if (Array.isArray(checks)) {
      const hasAccess = await allChecksPassed<TContext, TArgs>(checks, context, args);
      if (!hasAccess) {
        throw new DefaultError('Access is denied', { status: 403 });
      }
    } else {
      const { and, or } = checks;
      const andPassed = and ? await allChecksPassed<TContext, TArgs>(and, context, args) : true;
      const orPassed = or ? await oneCheckPassed<TContext, TArgs>(or, context, args) : true;
      if (!andPassed || !orPassed) {
        throw new DefaultError('Access is denied', { status: 403 });
      }
    }
    return resolver(_, args, context, info);
  };
}
