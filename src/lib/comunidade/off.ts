// Chave geral: COMMUNITY_OFF=1 no ambiente desliga a Comunidade em todos os restaurantes.
// Num arquivo só dela para quem precisa da chave (telão, funil) não arrastar o voto junto.
export const communityOff = () => process.env.COMMUNITY_OFF === "1";
