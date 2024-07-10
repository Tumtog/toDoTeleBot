require("dotenv").config();
const {
  Bot,
  Context,
  GrammyError,
  HttpError,
  InlineKeyboard,
} = require("grammy");

const logger = require("pino")();
const pool = require("./database.js"); // Файл базы данных
const bot = new Bot(process.env.BOT_API_KEY);

// Хранение идентификаторов сообщений для каждого пользователя
const userMessages = {};

// ======================================================================================================================
// Все команды бота
bot.api.setMyCommands([
  {
    command: "start",
    description: "Начать",
  },
  // {
  //   command: "addtask",
  //   description: "Добавить задачу",
  // },
  {
    command: "viewtasks",
    description: "Посмотреть задачи",
  },
  {
    command: "deletealltasks",
    description: "Удалить все задачи",
  },
]);

// функция для вывода всех задач пользователю
async function viewTasks(ctx) {
  const userId = ctx.from.id;

  try {
    // Удаляем старые сообщения
    if (userMessages[userId]) {
      for (const messageId of userMessages[userId]) {
        try {
          await ctx.api.deleteMessage(ctx.chat.id, messageId);
        } catch (err) {
          logger.error(`Ошибка при удалении сообщения ${messageId}: ${err}`);
        }
      }
      userMessages[userId] = [];
    }

    const res = await pool.query(
      "SELECT id, content FROM notes WHERE user_id = $1",
      [userId]
    );
    const rows = res.rows;

    if (rows.length === 0) {
      const message = await ctx.reply("У вас нет сохраненных задач.");
      if (!userMessages[userId]) userMessages[userId] = [];
      userMessages[userId].push(message.message_id);
    } else {
      const message = await ctx.reply("Ваши задачи:");
      if (!userMessages[userId]) userMessages[userId] = [];
      userMessages[userId].push(message.message_id);

      for (const row of rows) {
        const content = row.content.trim();
        let taskKeyboard;

        if (content.startsWith("✅")) {
          // Если задача уже выполнена, показываем кнопку "Не сделано"
          taskKeyboard = new InlineKeyboard()
            .text("Не сделано", `notdone_${row.id}`)
            .text("Изменить", `edit_${row.id}`)
            .text("Удалить", `delete_${row.id}`);
        } else {
          // Если задача не выполнена, показываем кнопку "Сделано"
          taskKeyboard = new InlineKeyboard()
            .text("Сделано", `done_${row.id}`)
            .text("Изменить", `edit_${row.id}`)
            .text("Удалить", `delete_${row.id}`);
        }
        const taskMessage = await ctx.reply(content, {
          reply_markup: taskKeyboard,
        });
        userMessages[userId].push(taskMessage.message_id);
      }
    }
  } catch (err) {
    logger.error(`Ошибка при получении задач: ${err}`);
    await ctx.reply("Произошла ошибка при получении задач.");
  }
}

// Состояние редактирования задачи
const editState = {};

// BODY======================================================================================================================

bot.command("start", (ctx) => {
  ctx.reply(
    `Привет! Я твой персональный бот для управления задачами.<br><br>
Вот что я умею:<br>
- Просто отправь мне сообщение, чтобы добавить новую задачу.<br>
- Используй команду /viewtasks, чтобы посмотреть все свои задачи.<br>
- Используй команду /deletealltasks, чтобы удалить все задачи.<br><br>
Каждая задача имеет следующие кнопки:<br>
- "Сделано" / "Не сделано" для изменения статуса задачи.<br>
- "Изменить" для редактирования задачи.<br>
- "Удалить" для удаления задачи.`,
    { parse_mode: "HTML" }
  );
});

// Команда удалить все задачи
bot.command("deletealltasks", async (ctx) => {
  const userId = ctx.from.id;

  try {
    const res = await pool.query("DELETE FROM notes WHERE user_id = $1", [
      userId,
    ]);

    if (res.rowCount === 0) {
      await ctx.reply("У вас нет сохраненных задач.");
      return;
    }

    await ctx.reply("Все ваши задачи удалены.");
  } catch (err) {
    logger.error(`Ошибка при удалении задач: ${err}`);
    await ctx.reply("Произошла ошибка при удалении задач.");
  }
});

// Команда посмотреть все задачи
bot.command("viewtasks", async (ctx) => {
  await viewTasks(ctx);
});

// Обработка нажатий на инлайн-кнопки
bot.on("callback_query:data", async (ctx) => {
  const data = ctx.callbackQuery.data;
  const userId = ctx.from.id;

  try {
    const [action, taskId] = data.split("_");

    if (!action || !taskId) {
      logger.error(`Некорректные данные callback: ${data}`);
      return;
    }

    logger.info(`action: ${action}, taskId: ${taskId}`);

    if (action === "done") {
      const res = await pool.query(
        "SELECT content FROM notes WHERE id = $1 AND user_id = $2",
        [taskId, userId]
      );
      if (res.rows.length > 0) {
        const newContent = `✅ ${res.rows[0].content}`.trim();
        if (newContent) {
          await pool.query(
            "UPDATE notes SET content = $1 WHERE id = $2 AND user_id = $3",
            [newContent, taskId, userId]
          );
        }
      } else {
        await ctx.reply("Задача не найдена.");
      }
      await viewTasks(ctx);
    } else if (action === "notdone") {
      const res = await pool.query(
        "SELECT content FROM notes WHERE id = $1 AND user_id = $2",
        [taskId, userId]
      );
      if (res.rows.length > 0) {
        const newContent = res.rows[0].content.replace(/^✅ /, "").trim();
        if (newContent) {
          await pool.query(
            "UPDATE notes SET content = $1 WHERE id = $2 AND user_id = $3",
            [newContent, taskId, userId]
          );
        }
      } else {
        await ctx.reply("Задача не найдена.");
      }
      await viewTasks(ctx);
    } else if (action === "edit") {
      editState[userId] = taskId;
      await ctx.reply("Отправьте новое описание для задачи:");
    } else if (action === "delete") {
      await pool.query("DELETE FROM notes WHERE id = $1 AND user_id = $2", [
        taskId,
        userId,
      ]);
      await ctx.reply("Задача удалена!");
      await viewTasks(ctx);
    }

    await ctx.answerCallbackQuery(); // Удаляет значок загрузки
  } catch (err) {
    logger.error(`Ошибка при обработке callback-запроса: ${err}`);
  }
});

// Обработка всех сообщений
bot.on("message:text", async (ctx) => {
  const userId = ctx.from.id;
  const content = ctx.message.text.trim();

  if (editState[userId]) {
    const taskId = editState[userId];
    try {
      if (content) {
        await pool.query(
          "UPDATE notes SET content = $1 WHERE id = $2 AND user_id = $3",
          [content, taskId, userId]
        );
        await ctx.reply("Задача обновлена!");
        delete editState[userId];
      } else {
        await ctx.reply("Описание задачи не может быть пустым.");
      }
    } catch (err) {
      logger.error(`Ошибка при обновлении задачи: ${err}`);
      await ctx.reply("Произошла ошибка при обновлении задачи.");
    }
  } else {
    try {
      if (content) {
        await pool.query(
          "INSERT INTO notes (user_id, content) VALUES ($1, $2)",
          [userId, content]
        );
        await ctx.reply("Заметка сохранена!");
      } else {
        await ctx.reply("Описание заметки не может быть пустым.");
      }
    } catch (err) {
      logger.error(`Ошибка при сохранении заметки: ${err}`);
      await ctx.reply("Произошла ошибка при сохранении заметки.");
    }
  }

  await viewTasks(ctx); // Отображаем обновленный список задач
});

// ======================================================================================================================
// Обработчик ошибок
bot.catch((err) => {
  const ctx = err.ctx;
  console.error(`Error while handling update ${ctx.update.update_id}:`);
  const e = err.error;

  if (e instanceof GrammyError) {
    logger.error(`Ошибка в запросе: ${e.description}`);
  } else if (e instanceof HttpError) {
    logger.error(`Не удалось связаться с Telegram: ${e}`);
  } else {
    logger.error(`Неизвестная ошибка: ${e}`);
  }
});

bot.start();
