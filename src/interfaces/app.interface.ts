import {
  IncomingsPageInfo,
  IncomingsPageOriginalInfo,
  AbiturientInfo,
} from './prkom.interface';

export type AbiturientInfoResponse = {
  isCache: any;
  info: IncomingsPageInfo;
  originalInfo: IncomingsPageOriginalInfo;
  item: AbiturientInfo;
  filename: string;
  payload: {
    beforeOriginals: number;
    beforeGreens: number;
    afterGreens: number;
    totalItems: number;
  };
};

export type LastAbiturientInfo = Omit<AbiturientInfoResponse, 'originalInfo'>;

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
