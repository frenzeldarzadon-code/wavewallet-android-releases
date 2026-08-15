package com.wavewallet.gcashlistener.data

import android.content.Context
import androidx.room.ColumnInfo
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Index
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.Insert
import kotlinx.coroutines.flow.Flow

/** Durable local queue. Nothing is dropped when the phone is offline. */
@Entity(tableName = "queued_events", indices = [Index(value = ["eventUid"], unique = true)])
data class QueuedEvent(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val eventUid: String,
    val packageName: String,
    val postedAt: Long,
    val amountPhp: Double?,
    val senderNumber: String?,
    val senderName: String?,
    val rawText: String,
    val parserVersion: String,
    /** queued | sent | unparsed | rejected */
    @ColumnInfo(defaultValue = "queued") val status: String = "queued",
    val attempts: Int = 0,
    val lastError: String? = null,
    val serverResponse: String? = null,
    val isTest: Boolean = false,
    val updatedAt: Long = System.currentTimeMillis(),
)

@Dao
interface EventDao {
    /** IGNORE keeps duplicate/reposted notifications from being queued twice. */
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertIfNew(event: QueuedEvent): Long

    @Query("SELECT * FROM queued_events WHERE status = 'queued' ORDER BY postedAt ASC LIMIT 25")
    suspend fun pending(): List<QueuedEvent>

    @Query("SELECT COUNT(*) FROM queued_events WHERE status = 'queued'")
    fun pendingCount(): Flow<Int>

    @Query("SELECT * FROM queued_events ORDER BY id DESC LIMIT 30")
    fun recent(): Flow<List<QueuedEvent>>

    @Query("SELECT * FROM queued_events ORDER BY id DESC LIMIT 1")
    fun latest(): Flow<QueuedEvent?>

    @Query(
        "UPDATE queued_events SET status = :status, attempts = attempts + 1, " +
            "lastError = :error, serverResponse = :response, updatedAt = :now WHERE id = :id"
    )
    suspend fun mark(
        id: Long,
        status: String,
        error: String?,
        response: String?,
        now: Long = System.currentTimeMillis(),
    )
}

@Database(entities = [QueuedEvent::class], version = 1, exportSchema = false)
abstract class ListenerDb : RoomDatabase() {
    abstract fun events(): EventDao

    companion object {
        @Volatile private var instance: ListenerDb? = null

        fun get(context: Context): ListenerDb = instance ?: synchronized(this) {
            instance ?: Room.databaseBuilder(
                context.applicationContext,
                ListenerDb::class.java,
                "wavewallet-listener.db",
            ).build().also { instance = it }
        }
    }
}
