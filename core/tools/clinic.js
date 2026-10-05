const config = require("../config");

const getClinicInfo = {
  name: "get_clinic_info",
  description:
    "Вернуть проверенные сведения о враче, адресе клиники (со ссылкой на 2ГИС) и контактах (WhatsApp, Instagram). Используй для адреса, записи и связи.",
  parameters: {
    type: "object",
    properties: {
      topic: {
        type: "string",
        enum: ["all", "doctor", "location", "contacts"],
        description: "Какой блок информации нужен. По умолчанию all.",
      },
    },
  },
  async execute(args) {
    const topic = String(args.topic || "all");
    const doctor = {
      clinic: config.clinicName,
      name: config.doctorName,
      role: config.doctorRole,
    };
    const location = {
      city: config.city,
      address: config.address,
      map: config.mapUrl,
      note: "Удобное время приёма согласуется в WhatsApp.",
    };
    const contacts = {
      whatsapp: `https://wa.me/${config.whatsappNumber}`,
      whatsappNumber: config.whatsappNumber,
      instagram: config.instagramUrl,
    };

    if (topic === "doctor") return { doctor };
    if (topic === "location") return { location };
    if (topic === "contacts") return { contacts };

    return { doctor, location, contacts };
  },
};

module.exports = { getClinicInfo };
