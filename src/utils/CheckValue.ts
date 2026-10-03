export function isValidNumber(value: any): boolean {
  return typeof value === 'number' && Number.isFinite(value)
}

// ✅ ตัวอย่างการใช้งาน
// console.log(isValidNumber(null)) // false
// console.log(isValidNumber(undefined)) // false
// console.log(isValidNumber(NaN)) // false
// console.log(isValidNumber(Infinity)) // false
// console.log(isValidNumber(-Infinity)) // false
// console.log(isValidNumber('123')) // false
// console.log(isValidNumber(123)) // true
// console.log(isValidNumber(0)) // true
// console.log(isValidNumber(-45.6)) // true
