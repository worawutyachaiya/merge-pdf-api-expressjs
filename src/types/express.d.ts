// ประกาศ Type Augmentation สำหรับ Express
declare global {
  namespace Express {
    interface Request {
      validatedData?: {
        body?: any
        query?: any
        params?: any
        headers?: any
      }
    }
  }
}

// เพื่อทำให้ TypeScript รู้ว่านี่เป็นโมดูล
export {}
