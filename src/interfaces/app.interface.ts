import {
  MagaInfoType,
  MagaOriginalInfoType,
  MagaAbiturientInfo,
} from './prkom.interface';

export type MagaResponseInfo = {
  isCache: any;
  info: MagaInfoType;
  originalInfo: MagaOriginalInfoType;
  item: MagaAbiturientInfo;
  filename: string;
  payload: {
    afterGreens: number;
    beforeGreens: number;
    totalItems: number;
  };
};

export type LastMagaInfo = {
  isCache: any;
  info: MagaInfoType;
  item: MagaAbiturientInfo;
  filename: string;
};

//

export enum NotifyType {
  All,
  Important,
  Disabled,
}

export type BotTarget = {
  chatId: number;
  first_name: string;
  last_name: string;
  username: string;

  loadCount?: number;
  uid?: string;
  notifyType?: NotifyType;
  // uids: string[];
};
