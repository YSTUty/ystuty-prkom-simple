export type IncomingsLinkType = {
  id: string;
  fullName: string;
  /** Уровень подготовки */
  name: string;
  /** Форма обучения */
  levelType: string;

  /** Специальности */
  specialties: {
    id: string;
    /** Код специальности */
    code: string;
    name: string;
    fullName: string;

    files: {
      name: string;
      filename: string;
    }[];
  }[];
};

export enum AbiturientInfoStateType {
  Unknown = 0,
  Submitted = 1,
}

export enum FormTrainingType {
  Unknown = 0,
  FullTime = 1,
  Extramural = 2,
  PartTime = 3,
}

export enum LevelTrainingType {
  Unknown = 0,
  Bachelor = 1,
  Magister = 2,
  Postgraduate = 3,
}

export type MagaAbiturientInfo = {
  isGreen: boolean;
  position: number;
  uid: string;
  totalScore: number;
  scoreSubjects: number;
  scoreExam: number;
  scoreInterview: number;
  scoreCompetitive: number;
  preemptiveRight: boolean;
  consentTransfer: boolean;
  original: boolean;
  originalToUniversity: boolean;
  consentToanotherDirection: boolean;
  state: AbiturientInfoStateType | null;
};

export type MagaOriginalInfoType = {
  buildDate: string;
  prkomDate: string;
  competitionGroupName: string;
  formTraining: string;
  levelTraining: string;
  directionTraining: string;
  basisAdmission: string;
  sourceFunding: string;
  numbersInfo: string;
};

export type MagaInfoType = {
  buildDate: Date;
  prkom: {
    number: number;
    date: Date;
  };
  competitionGroupName: string;
  formTraining: number;
  levelTraining: number;
  directionTraining: {
    code: string;
    name: string;
  };
  basisAdmission: string;
  sourceFunding: string;
  numbersInfo: { total: number; enrolled: number; toenroll: number };
};

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

export type BotTarget = {
  chatId: number;
  first_name: string;
  last_name: string;
  username: string;

  loadCount?: number;
  uid?: string;
  powerOff?: boolean;
  // uids: string[];
};
