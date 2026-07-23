export interface TestUserData {
  email: string;
  phone: string;
  childName: string;
  parentName: string;
}

export function generateTestUser(): TestUserData {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);

  return {
    email: `test.quiz.${timestamp}.${random}@example.com`,
    phone: `+38099${String(Math.floor(Math.random() * 9000000) + 1000000)}`,
    childName: pickRandom(['Тест', 'Олег', 'Марія', 'Антон', 'Софія', 'Дмитро']),
    parentName: pickRandom(['Тестовий Батько', 'Олена', 'Іван', 'Наталія', 'Андрій']),
  };
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
