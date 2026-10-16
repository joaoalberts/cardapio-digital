// Chave geral: APARECA_OFF=1 no ambiente desliga o Apareça na TV em todos os restaurantes.
export const aparecaOff = () => process.env.APARECA_OFF === "1";
