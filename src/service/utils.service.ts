const getRandomArbitrary = (min: number, max: number) => {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

export const chooseWinner = async (array: Array<string>) => {
  const randNumber = await getRandomArbitrary(1, array.length);
  return array[randNumber];
};
