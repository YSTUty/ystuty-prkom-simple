import { Context, Scenes, NarrowedContext } from 'telegraf';
import {
  SceneSessionData,
  WizardContext,
  WizardContextWizard,
  WizardSessionData,
} from 'telegraf/typings/scenes';
import * as tt from 'telegraf/typings/core/types/typegram';
import { Deunionize } from 'telegraf/typings/deunionize';
import { MountMap } from 'telegraf/typings/telegram-types';

import { BotTarget } from './app.interface';

export type ISessionState = {
  startAt?: Date;
  isBlockedBot?: boolean;
} & BotTarget;

type SceneSession = {
  state: any;
} & SceneSessionData;

type WizardSession = {
  state: any;
} & WizardSessionData;

type ContextState = {
  appeal: boolean;
  [key: string]: any;
};

type CombinedContext = {
  session: ISessionState;
  sessionConversation: ISessionState;

  match?: RegExpExecArray;

  state: ContextState;

  scene: Scenes.SceneContextScene<
    Scenes.SceneContext<SceneSession>,
    SceneSession
  > & { state: any };
};

export type IContext<
  T = {},
  U extends Deunionize<tt.Update> = tt.Update,
> = CombinedContext & Context<U> & T;

export type INarrowedContext<
  U extends tt.Update = tt.Update,
  T = {},
> = CombinedContext & Context<U> & Omit<U, keyof Context> & T;

export type ITextMessageContext<T = {}> = CombinedContext &
  NarrowedContext<Context<tt.Update>, MountMap['text']> &
  T;
export type IMessageContext<T = {}> = IContext<T, tt.Update.MessageUpdate>;
export type ICallbackQueryContext<T = {}> = IContext<
  T,
  tt.Update.CallbackQueryUpdate
>;
export type ICbQOrMsg = IMessageContext | ICallbackQueryContext;

export type ISceneContext = (IMessageContext | ICallbackQueryContext) & {
  scene: Scenes.SceneContextScene<
    Scenes.SceneContext<SceneSession>,
    SceneSession
  > & { state: any };
};

export type IStepContext = (IMessageContext | ICallbackQueryContext) & {
  scene: Scenes.SceneContextScene<
    WizardContext<WizardSession>,
    WizardSession
  > & { state: any };
  session: Scenes.WizardSession<WizardSession>;
  wizard: WizardContextWizard<WizardContext<WizardSession>>;
};
