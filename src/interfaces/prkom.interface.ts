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

/** Тип состояния заявления */
export enum AbiturientInfoStateType {
  Unknown = 0,
  Submitted = 1,
  Enrolled = 2,
}

/** Тип формы обучения */
export enum FormTrainingType {
  Unknown = 0,
  FullTime = 1,
  Extramural = 2,
  PartTime = 3,
}

/** Тип уровня образования */
export enum LevelTrainingType {
  Unknown = 0,
  Bachelor = 1,
  Magister = 2,
  Postgraduate = 3,
}

/** Информация заявления (в магистратуру) */
export type MagaAbiturientInfo = {
  isGreen: boolean;
  position: number;
  uid: string;
  totalScore: number;
  scoreSubjects: number;
  scoreExam: number;
  // scoreInterview: number;
  scoreCompetitive: number;
  preemptiveRight: boolean;
  // consentTransfer: boolean;
  // original: boolean;
  originalToUniversity: boolean;
  // consentToanotherDirection: boolean;
  state: AbiturientInfoStateType | null;
  priority: number;
  priorityHight: number;
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
